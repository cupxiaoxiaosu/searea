# Tutorials (runnable demos)

Parent folder uses the **`tut*`** prefix: **`tutorials`**.

| Directory | Purpose |
| --- | --- |
| **`campus-shared/`** | Shared campus domain: JSX schema (`model.tsx`), `model-define.mjs`, `china-provinces.mjs`, `lib/campus-demo.mjs`, and **`app.tsx`** (Koa + schema + seeds). |
| **`koa-rest/`** | Koa + REST using `initCampusDemo()` (`npm run example:koa`). |
| **`koa-schema-jsx/`** | Koa + REST from compiled JSX schema only (`npm run example:koa:model`). |
| **`express-rest/`** | Express + same campus models (`npm run example:express`). |
| **`egg-campus/`** | Egg.js app wiring (`npm run example:egg`; install deps with `npm run example:egg:install`). |
| **`demo-blog-public/`** | Editorial blog SPA + REST + demo cookie auth (`npm run example:demo:blog`, default port `3760`). Optional `BLOG_DEMO_RESET=1`. Demo login `alex` / `demo123`. **`schema.tsx`** defines models + **`onPost`** hooks; **`demo-auth.mjs`** shares session context with `server.mjs`. |
| **`demo-recipes-pocket/`** | Recipes SPA + REST + demo sessions (`npm run example:demo:recipes`, default port `3762`). Optional `RECIPE_DEMO_RESET=1`. Same demo login. **`schema.tsx`** + **`demo-auth.mjs`** as above. |

All commands assume the **repository root** as cwd.
