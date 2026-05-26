/** @param {import('egg').Application} app */
export default (app) => {
  app.router.get("/", async (ctx) => {
    ctx.body = { ok: true, hint: "REST 在 /api/*，与 Koa 中间件一致" };
  });
};
