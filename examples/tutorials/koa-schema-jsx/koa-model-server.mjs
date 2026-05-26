/**
 * 使用 **`tutorials/campus-shared/model.tsx`**：由 **`createKoaRestMiddleware({ schema, authorize })`** 内部 **`compileSchema`**，挂载 **REST `/api`**。
 * 启动前必须 **`Model.useDB(db)`**（本示例：**内存 SQLite** + **`ensureTable`**，无演示种子）。
 * **`authorize`** 可选：保护同一中间件内的 **`backendPath`** 与管理端 **`adminPath`**。
 *
 *   npm run example:koa:model
 *
 * 建表 + 演示数据：**`npm run example:app`**
 */

import Koa from "koa";
import bodyParser from "koa-bodyparser";
import { tsImport } from "tsx/esm/api";

import { Model, createKoaRestMiddleware, createSqlite3Adaptor } from "searea";

const db = createSqlite3Adaptor({ filename: ":memory:" });
Model.useDB(db);

const mod = await tsImport("../campus-shared/model.tsx", import.meta.url);

const port = Number(process.env.PORT) || 3456;
const adminPath = "/model-site";
const backendPath = "/api";

/**
 * 可选：保护 `backendPath` + `adminPath` 下全部接口与静态后台。
 * 在此接入 session / JWT，判断「已登录」或「超管」后再 `await next()`。
 */
async function authorizeSearea(ctx, next) {
  // ctx.status = 403;
  await next();
}

const restMw = await createKoaRestMiddleware({
  backendPath,
  adminPath,
  schema: mod.default(),
  authorize: authorizeSearea,
});

for (const M of Object.values(restMw.models)) {
  await db.ensureTable(M);
}

const app = new Koa();
app.use(bodyParser());
app.use(restMw);

app.use(async (ctx) => {
  ctx.status = 404;
  ctx.body = "Not Found";
});

await new Promise((resolve, reject) => {
  try {
    const server = app.listen(port, "127.0.0.1", () => resolve());
    server.once("error", reject);
  } catch (e) {
    reject(e);
  }
});

const base = `http://127.0.0.1:${port}`;
const viteBase =
  adminPath === "" || adminPath === "/"
    ? "/"
    : `${adminPath.replace(/\/?$/, "/")}`;
console.log(`[example:koa:model] Admin / Meta / 前端（端口 ${port}）：`);
console.log(`  Admin  GET ${base}${backendPath}/models`);
console.log(`  Meta   GET ${base}${backendPath}/students/meta`);
const ui =
  adminPath === "" || adminPath === "/"
    ? `${base}/`
    : `${base}${adminPath.replace(/\/$/, "")}/`;
console.log(`  管理后台 ${ui}`);
console.log(`  改过前端源码后请先构建静态资源（本仓库根目录）：`);
console.log(`    VITE_FRONTEND_BASE=${viteBase} npm run frontend:build`);
console.log(`  或：npm run frontend:build:model-site`);
