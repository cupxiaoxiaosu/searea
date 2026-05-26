import path from "node:path";
import { fileURLToPath } from "node:url";

import { compileSchema } from "../../schema/compile.js";
import { createRestDispatch } from "../core/rest-dispatch.js";
import { createResponseFormatter } from "../core/response-format.js";
import { isSeareaMountedPath } from "../searea-mounted-path.js";
import { tryServeFrontendDistExpress } from "./serve-frontend.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readReqBodyRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/**
 * Express 中间件：与 `createKoaRestMiddleware` 相同 REST 语义，底层复用 `createRestDispatch`。
 *
 * **异步工厂**：`app.use(await createExpressRestMiddleware({ … }))`。返回的中间件函数上挂 **`models`**。
 *
 * 请在之前挂载 **`express.json()`**（及按需 `express.urlencoded`），否则将尝试自行读取原始 body。
 *
 * 可选 **`authorize`**：**`(req, res, next)`**，仅当路径落在 **`backendPath`** 或 **`adminPath`** 时先于 REST / 静态托管执行；语义与 **`createKoaRestMiddleware`** 一致。
 *
 * @param {Parameters<import('../core/rest-dispatch.js').createRestDispatch>[0] & {
 *   backendPath?: string,
 *   prefix?: string,
 *   schema?: object,
 *   adminPath?: string,
 *   frontendBasePath?: string,
 *   frontendPath?: string,
 *   serveFrontendDist?: boolean,
 *   authorize?: (req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => unknown,
 * }} [options]
 */
export async function createExpressRestMiddleware(options = {}) {
  const backendPath = (options.backendPath ?? options.prefix ?? "/api").replace(/\/$/, "");
  const adminPath = options.adminPath ?? options.frontendBasePath ?? "/model-site";
  const frontendPath = options.frontendPath ?? path.resolve(__dirname, "../../frontend");
  const serveFrontendDist =
    Boolean(frontendPath) &&
    (typeof options.serveFrontendDist === "boolean" ? options.serveFrontendDist : true);

  if (options.schema != null && options.models != null) {
    throw new Error("createExpressRestMiddleware: pass either schema or models, not both");
  }

  let models = options.models;
  if (options.schema != null) {
    ({ models } = await compileSchema(options.schema));
  }
  if (!models || typeof models !== "object") {
    throw new Error("createExpressRestMiddleware: pass models or schema");
  }

  const authorize = options.authorize;
  if (authorize != null && typeof authorize !== "function") {
    throw new Error("createExpressRestMiddleware: authorize must be an Express middleware function");
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

  async function seareaExpressRest(req, res, outerNext) {
    const pathname = req.path || "/";

    async function run() {
      async function readJsonBody() {
        if (
          req.body != null &&
          typeof req.body === "object" &&
          !Buffer.isBuffer(req.body)
        ) {
          return req.body;
        }
        const raw = await readReqBodyRaw(req);
        if (!raw.length) return {};
        try {
          return JSON.parse(raw.toString("utf8"));
        } catch {
          const err = new Error("Invalid JSON");
          err.status = 400;
          throw err;
        }
      }

      const passthrough = async () => {
        if (serveFrontendDist && frontendPath) {
          try {
            if (
              await tryServeFrontendDistExpress(req, res, {
                frontendPath,
                backendPath,
                adminPath,
                extraScript,
              })
            ) {
              return;
            }
          } catch (e) {
            outerNext(e);
            return;
          }
        }
        outerNext();
      };

      let result;
      try {
        result = await dispatch({
          method: req.method,
          pathname,
          query: req.query,
          readJsonBody,
        });
      } catch (e) {
        outerNext(e);
        return;
      }

      if (result.type === "next") {
        await passthrough();
        return;
      }

      res.status(result.status);
      if (result.headers) {
        for (const [k, v] of Object.entries(result.headers)) {
          res.setHeader(k, v);
        }
      }
      if (result.status === 204) {
        res.end();
        return;
      }
      if (result.body !== undefined) {
        res.json(result.body);
        return;
      }
      res.end();
    }

    async function gateNext(err) {
      if (err != null) {
        outerNext(err);
        return;
      }
      try {
        await run();
      } catch (e) {
        outerNext(e);
      }
    }

    if (authorize && isSeareaMountedPath(pathname, backendPath, adminPath)) {
      authorize(req, res, gateNext);
      return;
    }

    gateNext();
  }

  seareaExpressRest.models = models;
  return seareaExpressRest;
}
