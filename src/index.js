import Model from "./core/model.js";

/**
 * defineModel("student", fields, { managers })
 * 返回 `Promise<具体模型类>`；默认不自动建表，需显式调用 `db.ensureTable(ModelClass)` 或传 `ensureTable: true` 给 `init` / `define`。
 */
export async function defineModel(name, fields, { managers, db } = {}) {
  const table = String(name);

  class ConcreteModel extends Model {}

  await ConcreteModel.init({ table, fields, managers, db });

  return ConcreteModel;
}

export { default as Model, normalizeExpandList } from "./core/model.js";
export { Manager, QuerySet, ReverseManager, ManyToManyManager } from "./core/model.js";
export { createSqlite3Adaptor } from "./db-adapters/sqlite3.js";
export { createMysqlAdaptor } from "./db-adapters/mysql.js";
export {
  createKoaRestMiddleware,
  createServeFrontendDistMiddleware,
  createExpressRestMiddleware,
  createEggSeareaRestMiddleware,
  createEggServeFrontendDistMiddleware,
  tryServeFrontendDistExpress,
  isSeareaMountedPath,
  createResponseFormatter,
} from "./server-adapters/index.js";

export {
  compileSchema,
  Database,
  Table,
  CharField,
  TextField,
  IntegerField,
  BooleanField,
  DateField,
  DateTimeField,
  ForeignKey,
  ManyToManyField,
  createElement,
  Fragment,
} from "./schema/index.js";

