import path from "node:path";
import { fileURLToPath } from "node:url";

import { compileSchema } from "../../schema/compile.js";
import { createRestDispatch, pickWritableAttrs } from "../core/rest-dispatch.js";
import { createResponseFormatter } from "../core/response-format.js";
import { tryServeFrontendDist } from "./serve-frontend.js";
import { isSeareaMountedPath } from "../searea-mounted-path.js";

export { isSeareaMountedPath };

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function getJsonBody(ctx) {
  if (
    ctx.request.body != null &&
    typeof ctx.request.body === "object" &&
    !Buffer.isBuffer(ctx.request.body)
  ) {
    return ctx.request.body;
  }
  const raw = await new Promise((resolve, reject) => {
    const chunks = [];
    ctx.req.on("data", (c) => chunks.push(c));
    ctx.req.on("end", () => resolve(Buffer.concat(chunks)));
    ctx.req.on("error", reject);
  });
  if (!raw.length) return {};
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    const err = new Error("Invalid JSON");
    err.status = 400;
    throw err;
  }
}

/**
 * Koa 中间件：为已注册的模型提供极简 REST JSON API。
 *
 * **异步工厂**：`app.use(await createKoaRestMiddleware({ … }))`。返回的中间件函数上挂 **`models`**（本次注册用的模型表），便于在 `ensureTable` / 种子数据等场景复用。
 *
 * @param {object} [options]
 * @param {string} [options.backendPath='/api'] — REST 挂载前缀，无尾部斜杠（兼容旧字段 `prefix`）
 * @param {object} [options.schema] — JSX `<Database>` 根节点；若提供则内部 **`await compileSchema(schema)`**，无须再传 **`models`**。与 **`models`** 二选一。
 * @param {Record<string, typeof Model>} [options.models] — 路由资源名 → 模型类（已 init）；不提供 **`schema`** 时必填
 * @param {Record<string, { onPost?: Function, onGetList?: Function, onGetItem?: Function, onPatch?: Function, onDelete?: Function }>} [options.events] — 可选，按资源**覆盖**各模型类上已有的 **`Model.events`**（一般不必传，REST 会从模型读取）
 * @param {Array<{ key: string, modelName?: string, admin?: object }>} [options.adminCatalog] — 非空时覆盖默认目录；默认从各模型 `Model.admin` 生成
 * @param {string} [options.adminPath='/model-site'] — 管理端 SPA 的 URL 前缀（与构建时 `VITE_FRONTEND_BASE` 一致）。兼容旧字段 **`frontendBasePath`**
 * @param {string} [options.frontendPath] — 极少需要：覆盖内置的管理端源码目录（默认包内 **`src/frontend`**）
 * @param {boolean} [options.serveFrontendDist] — 是否托管 `frontendPath/dist`；未指定且 `frontendPath` 非空时默认为 `true`
 * @param {(ctx: import('koa').Context, next: import('koa').Next) => Promise<void>} [options.authorize]
 *     — Koa 中间件；仅在请求路径属于 **`backendPath`** 或 **`adminPath`**（与静态托管一致）时先执行，
 *       通过后继续处理 REST 与管理端。典型用途：校验已登录或超管后才开放整套 API 与后台。不传则不作校验。
 *
 * 路由（相对于 backendPath）：
 * - `GET    /models` — Admin：已注册模型列表（勿将资源名设为 `models`）
 * - `GET    /api-docs` — Admin：简易 OpenAPI 块（勿占用资源名 `api-docs`）
 * - `GET    /schema-diff` — Admin：模型 vs 数据库差异（勿占用资源名 `schema-diff`）
 * - `POST   /schema-migrate` — Admin：执行迁移；请求体须含 `diff`（与 GET `/schema-diff` 同形快照），可选 `resourceKey` 限定只跑单表
 * - `GET    /{resource}/meta` — Admin：字段元数据 + reverseRelations（Schema / 表单）
 * - `GET    /{resource}` — 列表；带 `page` 或 `pageSize` 时为 `{ items, total, page, pageSize }`，并默认展开全部外键
 * - `GET    /{resource}?expand=school,district` — 按字段名展开 FK
 * - `GET    /{resource}/:id`
 * - `POST   /{resource}` — 201，`Location` 指向新资源
 * - `PATCH` / `PUT` `/{resource}/:id` — 部分更新
 * - `DELETE /{resource}/:id` — 204
 *
 * 建议在之前挂载 `koa-bodyparser`，否则会尝试自行读取 req body（且不能与已消费流的中间件混用）。
 *
 * REST 语义实现见 `createRestDispatch`（`server-adapters/core/rest-dispatch.js`），Egg/Express 可复用该层。
 */
export async function createKoaRestMiddleware(options = {}) {
  const backendPath = (options.backendPath ?? options.prefix ?? "/api").replace(/\/$/, "");
  const adminPath = options.adminPath ?? options.frontendBasePath ?? "/model-site";
  const frontendPath = options.frontendPath ?? path.resolve(__dirname, "../../frontend");
  const serveFrontendDist =
    Boolean(frontendPath) &&
    (typeof options.serveFrontendDist === "boolean" ? options.serveFrontendDist : true);

  if (options.schema != null && options.models != null) {
    throw new Error("createKoaRestMiddleware: pass either schema or models, not both");
  }

  let models = options.models;
  if (options.schema != null) {
    ({ models } = await compileSchema(options.schema));
  }
  if (!models || typeof models !== "object") {
    throw new Error("createKoaRestMiddleware: pass models or schema");
  }

  const authorize = options.authorize;
  if (authorize != null && typeof authorize !== "function") {
    throw new Error("createKoaRestMiddleware: authorize must be a Koa middleware function");
  }

  const dispatch = createRestDispatch({
    backendPath,
    models,
    events: options.events,
    adminCatalog: options.adminCatalog,
    formatResponse: options.formatResponse,
  });

  const formatFormatter = createResponseFormatter({ formatResponse: options.formatResponse });
  const extraScript = formatFormatter.injectScript();

  async function koaRestModels(ctx, next) {
    const run = async () => {
      const passthrough = async () => {
        if (
          serveFrontendDist &&
          frontendPath &&
          (await tryServeFrontendDist(ctx, { frontendPath, backendPath, adminPath, extraScript }))
        ) {
          return;
        }
        return next();
      };

      const readJsonBody = () => getJsonBody(ctx);

      let result;
      try {
        result = await dispatch({
          method: ctx.method,
          pathname: ctx.path,
          query: ctx.query,
          readJsonBody,
        });
      } catch (e) {
        throw e;
      }

      if (result.type === "next") {
        return passthrough();
      }

      ctx.status = result.status;
      if (result.headers) {
        for (const [k, v] of Object.entries(result.headers)) {
          ctx.set(k, v);
        }
      }
      if (result.status === 204) {
        ctx.body = null;
        return;
      }
      ctx.body = result.body;
    };

    if (
      authorize &&
      isSeareaMountedPath(ctx.path, backendPath, adminPath)
    ) {
      return authorize(ctx, run);
    }
    return run();
  }

  koaRestModels.models = models;
  return koaRestModels;
}

export { pickWritableAttrs };
