# `src/` — Searea package layout

| Path | Role |
|------|------|
| `index.js` | Public API: `Model`, DB adapters, schema / JSX helpers, Koa middleware. |
| `core/` | ORM core: model, queryset, managers, validation. |
| `db-adapters/` | SQLite / MySQL：`createSqlite3Adaptor`、`createMysqlAdaptor`。可选 **`logSql`** 或环境变量 **`SEAREA_LOG_SQL=1`** 打印 ORM 触发的 SQL 与占位参数。 |
| `schema/` | JSX schema DSL: `jsx-runtime` / `jsx-dev-runtime`, field components, `compileSchema`. Set **`jsxImportSource: "searea"`**. |
| `server-adapters/` | **`core/`**：与框架无关的 REST 调度、`admin-meta`、`schema-diff`（可供 Egg / Express 等复用 **`createRestDispatch`**）。**`koa/`**：`createKoaRestMiddleware`、`serve-frontend`。 |

可选子路径导出（advanced）： **`searea/server-adapters`**（与 **`createRestDispatch`** 等）。

## Consumption

```js
import { Model, compileSchema, createSqlite3Adaptor } from "searea";
```

Automatic JSX:

```js
import { jsx } from "searea/jsx-runtime"; // tooling resolves via package exports
```

Or rely on **`jsxImportSource: "searea"`** so the compiler emits those imports.
