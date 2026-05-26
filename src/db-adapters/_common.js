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

