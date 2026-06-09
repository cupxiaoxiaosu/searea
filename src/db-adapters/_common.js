export function sqlLiteral(v) {
  if (v === null) return "NULL";
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "1" : "0";
  return `'${String(v).replaceAll("'", "''")}'`;
}

export function buildWhere(quoteIdent, where = {}) {
  const clauses = [];
  const params = [];

  for (const [key, value] of Object.entries(where ?? {})) {
    const col = quoteIdent(key);
    if (value === null) {
      clauses.push(`${col} IS NULL`);
      continue;
    }

    if (value && typeof value === "object" && !Array.isArray(value)) {
      if ("$in" in value) {
        const arr = value.$in;
        if (!Array.isArray(arr) || arr.length === 0) {
          clauses.push("0");
          continue;
        }
        const qs = arr.map(() => "?").join(", ");
        clauses.push(`${col} IN (${qs})`);
        params.push(...arr);
        continue;
      }
      if ("$gte" in value) {
        clauses.push(`${col} >= ?`);
        params.push(value.$gte);
        continue;
      }
      if ("$gt" in value) {
        clauses.push(`${col} > ?`);
        params.push(value.$gt);
        continue;
      }
      if ("$lte" in value) {
        clauses.push(`${col} <= ?`);
        params.push(value.$lte);
        continue;
      }
      if ("$lt" in value) {
        clauses.push(`${col} < ?`);
        params.push(value.$lt);
        continue;
      }
    }

    clauses.push(`${col} = ?`);
    params.push(value);
  }

  return {
    sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

export function createFieldToSqlMapper({ dialect, quoteIdent }) {
  return function mapFieldToSql(fieldDef) {
    const t = fieldDef?.type;
    const isPk = Boolean(fieldDef?.primaryKey);
    const isNull = Boolean(fieldDef?.null);
    const hasDefault =
      fieldDef &&
      typeof fieldDef === "object" &&
      Object.prototype.hasOwnProperty.call(fieldDef, "default");

    if (isPk) {
      if (dialect === "mysql") return "BIGINT PRIMARY KEY AUTO_INCREMENT";
      return "INTEGER PRIMARY KEY AUTOINCREMENT";
    }

    let sqlType;
    if (t === "number") sqlType = dialect === "mysql" ? "BIGINT" : "INTEGER";
    else if (t === "fk") sqlType = dialect === "mysql" ? "BIGINT" : "INTEGER";
    else if (t === "date") sqlType = "DATE";
    else if (t === "datetime") sqlType = "DATETIME";
    else if (t === "char") {
      const ml = fieldDef?.max_length;
      if (typeof ml === "number" && Number.isFinite(ml) && ml > 0) {
        sqlType = `VARCHAR(${Math.floor(ml)})`;
      } else {
        throw new Error('Field type "char" requires a positive max_length');
      }
    } else if (t === "text") {
      sqlType = "TEXT";
    } else {
      throw new Error(`Unsupported field type "${t}"`);
    }

    const parts = [sqlType, isNull ? "" : "NOT NULL"];
    if (hasDefault) parts.push(`DEFAULT ${sqlLiteral(fieldDef.default)}`);
    return parts.filter(Boolean).join(" ");
  };
}

function modelColumnSqlEntries({ modelClass, quoteIdent, mapFieldToSql }) {
  const table = modelClass.table;
  const fields = modelClass.fields ?? {};
  if (!table) throw new Error("Model.table is required");

  const columnsSql = Object.entries(fields)
    .filter(([, def]) => def?.type !== "m2m")
    .map(([name, def]) => `${quoteIdent(name)} ${mapFieldToSql(def)}`);

  if (columnsSql.length === 0) {
    throw new Error(`Model ${modelClass.name} must define at least 1 field`);
  }

  return { table, fields, columnsSql };
}

/**
 * Shared SQL CRUD skeleton for DB adapters. Adapters provide only dialect-specific
 * execution functions and result mapping.
 */
export function createCrudMethods({
  quoteIdent,
  mapFieldToSql,
  exec,
  get,
  all,
  run,
  emptyInsertSql,
  createTableSuffix = "",
  formatInsertResult,
  updateChangeCount,
  deleteChangeCount,
}) {
  async function ensureTable(modelClass) {
    const { table, fields, columnsSql } = modelColumnSqlEntries({
      modelClass,
      quoteIdent,
      mapFieldToSql,
    });

    await exec(
      `CREATE TABLE IF NOT EXISTS ${quoteIdent(table)} (${columnsSql.join(", ")})${createTableSuffix}`
    );

    for (const def of Object.values(fields)) {
      if (def?.type === "m2m" && def.throughModel) {
        await ensureTable(def.throughModel);
      }
    }
  }

  async function insert(table, attrs) {
    const keys = Object.keys(attrs);
    if (keys.length === 0) {
      const res = await run(emptyInsertSql(quoteIdent(table)));
      return formatInsertResult(res, attrs);
    }

    const cols = keys.map(quoteIdent).join(", ");
    const placeholders = keys.map(() => "?").join(", ");
    const params = keys.map((k) => attrs[k]);
    const res = await run(
      `INSERT INTO ${quoteIdent(table)} (${cols}) VALUES (${placeholders})`,
      params
    );
    return formatInsertResult(res, attrs);
  }

  async function select(table, where = {}, { limit, offset } = {}) {
    const w = buildWhere(quoteIdent, where);
    let sql = `SELECT * FROM ${quoteIdent(table)} ${w.sql}`;
    if (typeof limit === "number") sql += ` LIMIT ${limit}`;
    if (typeof offset === "number") sql += ` OFFSET ${offset}`;
    return all(sql, w.params);
  }

  async function count(table, where = {}) {
    const w = buildWhere(quoteIdent, where);
    const row = await get(`SELECT COUNT(*) AS cnt FROM ${quoteIdent(table)} ${w.sql}`, w.params);
    return Number(row?.cnt ?? 0);
  }

  async function aggregate(fn, table, column, where = {}) {
    const w = buildWhere(quoteIdent, where);
    const row = await get(
      `SELECT ${fn}(${quoteIdent(column)}) AS agg FROM ${quoteIdent(table)} ${w.sql}`,
      w.params
    );
    const v = row?.agg;
    if (v == null) return null;
    return Number(v);
  }

  async function update(table, where, attrs) {
    const setKeys = Object.keys(attrs);
    const setSql = setKeys.map((k) => `${quoteIdent(k)} = ?`).join(", ");
    const setParams = setKeys.map((k) => attrs[k]);
    const w = buildWhere(quoteIdent, where);
    const res = await run(
      `UPDATE ${quoteIdent(table)} SET ${setSql} ${w.sql}`,
      [...setParams, ...w.params]
    );
    return updateChangeCount(res);
  }

  async function deleteRows(table, where) {
    const w = buildWhere(quoteIdent, where);
    const res = await run(`DELETE FROM ${quoteIdent(table)} ${w.sql}`, w.params);
    return deleteChangeCount(res);
  }

  return {
    ensureTable,
    insert,
    select,
    count,
    sum: (table, column, where = {}) => aggregate("SUM", table, column, where),
    avg: (table, column, where = {}) => aggregate("AVG", table, column, where),
    update,
    delete: deleteRows,
  };
}

export function createAdapterMethods({ dialect, close, get, all, exec, crud }) {
  return {
    dialect,
    close,

    async rawGet(sql, params = []) {
      return get(sql, params);
    },

    async rawAll(sql, params = []) {
      return all(sql, params);
    },

    async exec(sql) {
      await exec(sql);
    },

    ...crud,
  };
}

/**
 * 是否在执行 ORM 触发的 SQL 时打印语句与占位参数。
 *
 * - **`logSql: true`** — `console.error("[searea sql:…]", sql, params?)`
 * - **`logSql: false`** — 关闭（且**忽略**环境变量）
 * - **`logSql: (info) => void`** — `info` 为 `{ sql, params, dialect }`
 * - 未传 **`logSql`** — 仅当环境变量 **`SEAREA_LOG_SQL=1`** 或 **`true`** 时等价于 `true`
 *
 * @param {{ logSql?: boolean | ((info: { sql: string, params: unknown[], dialect?: string }) => void), dialect?: string }} [opts]
 * @returns {((sql: string, params?: unknown[]) => void) | null}
 */
export function resolveSqlLogger(opts = {}) {
  const { logSql, dialect } = opts;
  if (logSql === false) return null;
  if (typeof logSql === "function") {
    return (sql, params = []) => logSql({ sql, params: [...params], dialect });
  }
  const envOn = process.env.SEAREA_LOG_SQL === "1" || process.env.SEAREA_LOG_SQL === "true";
  if (logSql === true || (logSql === undefined && envOn)) {
    const tag = dialect ? `[searea sql:${dialect}]` : "[searea sql]";
    return (sql, params = []) => {
      if (params.length) console.error(tag, sql, params);
      else console.error(tag, sql);
    };
  }
  return null;
}

