/**
 * Express 示例：与 `koa-rest-server.mjs` 共用 `initCampusDemo()`（默认 `model-define.mjs`）。
 *
 *   npm run example:express
 *   DB=mysql MYSQL_URL=... npm run example:express
 *
 * 默认端口 3458（避免与 Koa 3456 冲突）。
 *
 * **`authorize`** 可选：**不传则不鉴权**；仅在需要时用 Express **`(req, res, next)`** 保护 **`/api`** 与默认管理端路径。
 */
import express from "express";

import { createExpressRestMiddleware } from "searea";

import { initCampusDemo } from "../campus-shared/lib/campus-demo.mjs";

const { models } = await initCampusDemo();

const app = express();
app.use(express.json());

const adminPath = process.env.ADMIN_PATH || "/admin-site2";

app.use(
  await createExpressRestMiddleware({
    models,
    adminPath,
    formatResponse: ({ body, success }) => {
      if (success) {
        return {
          message: "Success",
          data: body,
          code: 0,
        };
      }
      return {
        message: body?.error || "Error",
        data: null,
        code: -1,
        ...(body && typeof body === "object" ? body : {}),
      };
    },
  })
);

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((err, _req, res, _next) => {
  const status = err.status && Number.isFinite(err.status) ? err.status : 500;
  res.status(status).json({ error: err.message || "Error" });
});

const port = Number(process.env.PORT) || 3458;
app.listen(port, () => {
  const base = `http://127.0.0.1:${port}`;
  console.log(`Express + Searea listening on ${base}`);
  console.log(`  Admin UI → ${base}${adminPath}/`);
  console.log(`  Admin API GET ${base}/api/models`);
  console.log(`  Meta  GET ${base}/api/students/meta`);
});
