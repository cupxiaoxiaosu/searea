export { createKoaRestMiddleware } from "./koa/koa.js";
export { createServeFrontendDistMiddleware } from "./koa/serve-frontend.js";

export { createExpressRestMiddleware } from "./express/express.js";
export { tryServeFrontendDistExpress } from "./express/serve-frontend.js";
export { createAdminAuth } from "./express/admin-auth.js";

export {
  createEggSeareaRestMiddleware,
  createEggServeFrontendDistMiddleware,
} from "./egg/egg.js";

export { isSeareaMountedPath } from "./searea-mounted-path.js";

export {
  createRestDispatch,
  pickWritableAttrs,
  valuesOptsFromQuery,
  listFiltersFromQuery,
} from "./core/rest-dispatch.js";

export {
  buildApiDocs,
  buildResourceMeta,
  coerceFilterValue,
  fkFieldNames,
  guessModelName,
  normalizeAdminCatalog,
} from "./core/admin-meta.js";

export { createResponseFormatter } from "./core/response-format.js";

export { applySchemaMigration, computeSchemaDiff } from "./core/schema-diff.js";
