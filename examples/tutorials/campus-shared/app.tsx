// @ts-nocheck
/** @jsxImportSource searea
 *
 * 与当前目录 **`model.tsx`** 同源：由 **`createKoaRestMiddleware({ schema })`** 内部编译并挂 REST（始终走 JSX）。
 *
 *   npm run example:app
 *
 * 轻量 JSX + REST（内存库、空表、无种子）：**`npm run example:koa:model`**
 * 默认校园示例（`model-define` / `CAMPUS_SCHEMA=jsx`）：**`npm run example:koa`**
 *
 * Table 上 `on*` 为 REST **events**（在 **`Model.events`** 上），详见 README。
 */
import Koa from "koa";
import bodyParser from "koa-bodyparser";

import { Model, createKoaRestMiddleware } from "searea";

import App from "./model.tsx";
import {
  CAMPUS_TABLES,
  createCampusDb,
  seedCampusDemoOrSkip,
} from "./lib/campus-demo.mjs";

const port = Number(process.env.PORT) || 3456;
const backendPath = "/api";
const adminPath = "/model-site";

const db = createCampusDb();
Model.useDB(db);

const restMw = await createKoaRestMiddleware({
  backendPath,
  adminPath,
  schema: App(),
});

for (const key of CAMPUS_TABLES) {
  const M = restMw.models[key];
  if (M) await db.ensureTable(M);
}

try {
  await seedCampusDemoOrSkip(restMw.models);
} catch (e) {
  const msg = e && e.message ? String(e.message) : String(e);
  console.warn("[example:app] 演示数据未写入（已跳过）：", msg);
}

const app = new Koa();
app.use(bodyParser());
app.use(restMw);

app.use(async (ctx) => {
  ctx.status = 404;
  ctx.body = { error: "Not found" };
});

app.listen(port, () => {
  const base = `http://127.0.0.1:${port}`;
  const viteBase =
    adminPath === "" || adminPath === "/"
      ? "/"
      : `${adminPath.replace(/\/?$/, "/")}`;
  console.log(`[example:app] Koa + schema(model.tsx) on ${base}`);
  console.log(`  Admin  GET ${base}${backendPath}/models`);
  console.log(`  Meta   GET ${base}${backendPath}/students/meta`);
  const ui =
    adminPath === "" || adminPath === "/"
      ? `${base}/`
      : `${base}${adminPath.replace(/\/$/, "")}/`;
  console.log(`  管理后台 ${ui}`);
  console.log(`  改过前端源码后请先构建静态资源（本仓库根目录）：`);
  console.log(`    VITE_FRONTEND_BASE=${viteBase} npm run frontend:build`);
});
