/**
 * 示例：Koa + 校园 schema（默认 `campus-shared/model-define.mjs`，`CAMPUS_SCHEMA=jsx` 时用 `campus-shared/model.tsx`）+ REST + 可选前端 dist。
 *
 *   npm run example:koa             # SQLite
 *   npm run example:koa:mysql      # MySQL
 *   npm run example:express         # Express 同源逻辑见 express-rest-server.mjs
 *   npm run example:egg             # Egg（Koa 核心）见 tutorials/egg-campus
 *
 * 数据与环境初始化见 **`tutorials/campus-shared/lib/campus-demo.mjs`**（`initCampusDemo`）。
 */

import Koa from "koa";
import bodyParser from "koa-bodyparser";

import { createKoaRestMiddleware } from "searea";

import { initCampusDemo } from "../campus-shared/lib/campus-demo.mjs";

const { models } = await initCampusDemo();

const app = new Koa();

app.use(bodyParser());

app.use(
  await createKoaRestMiddleware({
    models,
    adminPath: '/my-admin-site2'
  })
);

app.use(async (ctx) => {
  ctx.status = 404;
  ctx.body = { error: "Not found" };
});

const port = Number(process.env.PORT) || 3456;
app.listen(port, () => {
  const base = `http://127.0.0.1:${port}`;
  const backendPath = "/api";
  const frontendBasePath = "/model-site";
  const viteBase =
    frontendBasePath === "" || frontendBasePath === "/"
      ? "/"
      : `${frontendBasePath.replace(/\/?$/, "/")}`;
  console.log(`Koa listening on ${base}`);
  console.log(`  Admin  GET ${base}${backendPath}/models`);
  console.log(`  Meta   GET ${base}${backendPath}/students/meta`);
  const ui =
    frontendBasePath === "" || frontendBasePath === "/"
      ? `${base}/`
      : `${base}${frontendBasePath.replace(/\/$/, "")}/`;
  console.log(`  管理后台 ${ui}`);
  console.log(`  改过前端源码后请先构建静态资源（本仓库根目录）：`);
  console.log(`    VITE_FRONTEND_BASE=${viteBase} npm run frontend:build`);
  console.log(`  或：npm run frontend:build:model-site`);
});
