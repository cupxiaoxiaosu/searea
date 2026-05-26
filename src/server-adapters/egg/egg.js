/**
 * Egg.js 基于 Koa，`Context` 与中间件签名 `(ctx, next)` 一致，
 * 可直接使用 {@link ../koa/koa.js#createKoaRestMiddleware}，本体为别名便于按需引用。
 *
 * 在 Egg 中配置（示例）：
 * - `config/config.default.js`：`config.middleware = ['bodyParser', 'seareaRest'];`
 * - `app/middleware/searea_rest.js`：导出 `(options, app) => createEggSeareaRestMiddleware({ ...schema, ...options })`
 *
 * `schema` 为 **`{ models }`**（如 `initCampusDemo()` / `compileSchema` 的结果）；配合 **`await createEggSeareaRestMiddleware({ models })`** 或 **`{ schema: App() }`**。
 */
export { createKoaRestMiddleware as createEggSeareaRestMiddleware } from "../koa/koa.js";
export { createServeFrontendDistMiddleware as createEggServeFrontendDistMiddleware } from "../koa/serve-frontend.js";
