/**
 * Egg 示例：`Application` 继承 Koa，可直接 `app.use(createEggSeareaRestMiddleware(schema))`。
 * Schema 与 Koa 示例相同：默认 **`../campus-shared/model-define.mjs`**（`initCampusDemo`）。
 *
 * 首次请在仓库根目录执行：`npm run example:egg:install`
 * 然后：`npm run example:egg`（或 `cd examples/tutorials/egg-campus && npm start`）
 *
 * 默认端口 3457。
 */
import http from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { Application } from "egg";
import { createEggSeareaRestMiddleware } from "searea";

import { initCampusDemo } from "../campus-shared/lib/campus-demo.mjs";

const baseDir = fileURLToPath(new URL(".", import.meta.url));

const schema = await initCampusDemo();
const { models } = schema;

const app = new Application({
  baseDir: path.resolve(baseDir),
  type: "application",
  /** 非 egg-cluster 主控启动时必为 single，否则 cluster-client 缺少 port 会报错 */
  mode: "single",
});

await app.ready();

app.use(await createEggSeareaRestMiddleware({ models }));

const port = Number(process.env.PORT) || 3457;
http.createServer(app.callback()).listen(port, () => {
  const base = `http://127.0.0.1:${port}`;
  console.log(`Egg (Koa Application) + Searea listening on ${base}`);
  console.log(`  GET ${base}/`);
  console.log(`  Admin GET ${base}/api/models`);
});
