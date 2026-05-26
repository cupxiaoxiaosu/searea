# 管理后台（Vue 2 + Element UI + Vue Router + Vite）

界面逻辑对齐本地 **`jango/packages/admin-web-vue2`**（侧栏模型列表、`ModelView` CRUD/分页/关联、`Schema` 关系图）。

与 `examples/tutorials/koa-rest/koa-rest-server.mjs` 一致：**`backendPath`**（默认 `/api`）、**`adminPath`**（示例 `/model-site`，旧名 `frontendBasePath`）、以及 **`createKoaRestMiddleware`** 提供的 Admin JSON：

- `GET /api/models` — 模型目录（与可选 **`adminCatalog`** 顺序一致）
- `GET /api/:resource/meta` — 字段 `kind` / `reverseRelations`（Schema 与子表按钮）
- `GET /api/api-docs` — 简易文档（弹窗 API 说明）
- `GET /api/:resource?page=&pageSize=` — 分页列表（默认展开全部外键便于表格展示）

前端请求前缀使用 **`config.js` 的 `BACKEND_PATH`**（`/api`），与 SPA 的 `BASE_URL`（如 `/model-site/`）分离。

## 安装

```bash
# 在项目根目录（须安装 esbuild 平台可选依赖，勿省略 optional）
npm run frontend:install
```

## 仅 Koa（推荐联调）

构建后由 **`createKoaRestMiddleware`** 托管 `dist`，无需再开 Vite 端口。子路径必须与构建变量一致：

```bash
# 与示例里的 adminPath=/model-site 对应（注意末尾 /）
VITE_FRONTEND_BASE=/model-site/ npm run frontend:build

npm run example:koa
```

浏览器打开 `http://127.0.0.1:3456/model-site/`。

挂在站点根路径时：`adminPath` 留空、`VITE_FRONTEND_BASE=/`（默认），访问 `http://127.0.0.1:3456/`。

一键构建并生产模式启动：

```bash
npm run example:koa:prod
```

## 单独跑 Vite（热更新）

```bash
# 终端 1
npm run example:koa

# 终端 2（根路径开发；子路径开发时也设置相同的 VITE_FRONTEND_BASE）
npm run frontend:dev
```

浏览器打开 Vite 提示的地址（默认 http://127.0.0.1:5173）。环境变量见 `.env.development`（`VITE_PROXY_TARGET` 指向 Koa 端口）。

## 生产构建（任意挂载路径）

```bash
VITE_FRONTEND_BASE=/你的前缀/ npm run frontend:build
```

生成 `src/frontend/dist`。Koa 侧传入相同的 **`adminPath`**（无尾部斜杠，如 `/你的前缀`，旧名 **`frontendBasePath`**）。

## 与后端对齐

- 资源路径：`src/frontend/src/api/resources.js` 中的 `path` 须与 `models` 的 key 一致（`schools` / `students`）。
- 请求体：学生外键在 JSON 中使用字段名 **`school`**（数值 id），与 ORM / `pickWritableAttrs` 一致。
