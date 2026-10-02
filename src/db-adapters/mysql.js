import mysql from "mysql2/promise";

import { createAdapterMethods, createCrudMethods, createFieldToSqlMapper, resolveSqlLogger } from "./_common.js";

function quoteIdent(name) {
  return `\`${String(name).replaceAll("`", "``")}\``;
}

const mapFieldToSql = createFieldToSqlMapper({ dialect: "mysql", quoteIdent });

/**
 * @param {string} dbName
 */
async function ensureLogicalDatabaseExists(connectionConfig, dbName) {
  const trimmed = String(dbName ?? "").trim();
  if (!trimmed) return;

  const escaped = trimmed.replace(/`/g, "``");
  const conn = await mysql.createConnection({
    ...connectionConfig,
    multipleStatements: false,
  });
  try {
    await conn.execute(
      `CREATE DATABASE IF NOT EXISTS \`${escaped}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
  } finally {
    await conn.end();
  }
}

/**
 * @param {{ url?: string, host?: string, port?: number, user?: string, password?: string, database?: string }} opts
 */
async function ensureMysqlAdaptorDatabase(opts) {
  if (opts.url) {
    const u = new URL(opts.url);
    const dbName = decodeURIComponent((u.pathname || "/").slice(1) || "").trim();
    if (!dbName) return;
    const port = u.port ? Number(u.port) : 3306;
    await ensureLogicalDatabaseExists(
      {
        host: u.hostname,
        port,
        user: decodeURIComponent(u.username || "root"),
        password: decodeURIComponent(u.password ?? ""),
      },
      dbName
    );
    return;
  }

  const database = opts.database ?? "test";
  if (!String(database).trim()) return;
  await ensureLogicalDatabaseExists(
    {
      host: opts.host ?? "127.0.0.1",
      port: opts.port ?? 3306,
      user: opts.user ?? "root",
      password: opts.password ?? "",
    },
    database
  );
}

function createPoolOptions(opts) {
  const { url, host, port, user, password, database, connectionLimit = 8 } = opts;
  if (url) {
    return { uri: url, connectionLimit };
  }
  return {
    host: host ?? "127.0.0.1",
    port: port ?? 3306,
    user: user ?? "root",
    password: password ?? "",
    database: database ?? "test",
    connectionLimit,
  };
}

/**
 * 将写入参数转换为 MySQL 兼容格式：
 * - Date 对象 / ISO 8601 字符串 → 'YYYY-MM-DD HH:mm:ss'
 *   mysql2 能处理 Date 对象，此处统一兜底 ISO 字符串，避免 ER_TRUNCATED_WRONG_VALUE
 */
function toMysqlValue(v) {
  if (v instanceof Date) {
    return v.toISOString().slice(0, 19).replace("T", " ");
  }
  if (typeof v === "string") {
    const m = v.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/);
    if (m) return `${m[1]} ${m[2]}`;
  }
  return v;
}

/**
 * MySQL adaptor (mysql2/promise) with the same API shape as `createSqlite3Adaptor`.
 *
 * 首次执行任意 SQL 时会建立连接池；若未设置 **`ensureDatabase: false`**，会先对 URL / `database`
 * 中的逻辑库执行 **`CREATE DATABASE IF NOT EXISTS`**（业务侧无需再手动建库）。
 *
 * @param {{
 *  url?: string,
 *  host?: string,
 *  port?: number,
 *  user?: string,
 *  password?: string,
 *  database?: string,
 *  connectionLimit?: number,
 *  ensureDatabase?: boolean,
 *  logSql?: boolean | ((info: { sql: string, params: unknown[], dialect?: string }) => void),
 * }} opts
 */
export function createMysqlAdaptor(opts = {}) {
  const log = resolveSqlLogger({ logSql: opts.logSql, dialect: "mysql" });
  const ensureDb = opts.ensureDatabase !== false;
  const poolOpts = createPoolOptions(opts);

  let poolPromise = null;

  function getPool() {
    poolPromise ||= (async () => {
      if (ensureDb) {
        await ensureMysqlAdaptorDatabase(opts);
      }
      return mysql.createPool(poolOpts);
    })();
    return poolPromise;
  }

  async function query(sql, params = []) {
    log?.(sql, params);
    const pool = await getPool();
    const [rows] = await pool.query(sql, params.map(toMysqlValue));
    return rows;
  }

  async function exec(sql) {
    log?.(sql, []);
    const pool = await getPool();
    await pool.query(sql);
  }

  const get = async (sql, params = []) => {
    const rows = await query(sql, params);
    return Array.isArray(rows) ? (rows[0] ?? null) : null;
  };
  const all = async (sql, params = []) => {
    const rows = await query(sql, params);
    return Array.isArray(rows) ? rows : [];
  };
  const crud = createCrudMethods({
    quoteIdent,
    mapFieldToSql,
    exec,
    get,
    all,
    run: query,
    emptyInsertSql: (quotedTable) => `INSERT INTO ${quotedTable} () VALUES ()`,
    createTableSuffix: " ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;",
    formatInsertResult: (res, attrs) => {
      const insertId = res && typeof res === "object" && "insertId" in res ? res.insertId : null;
      if (insertId == null) return { ...attrs };
      return { ...attrs, id: insertId };
    },
    updateChangeCount: (res) => Number(res?.affectedRows ?? 0),
    deleteChangeCount: (res) => Number(res?.affectedRows ?? 0),
  });

  return createAdapterMethods({
    dialect: "mysql",
    close: async () => {
      if (!poolPromise) return;
      try {
        const pool = await poolPromise;
        await pool.end();
      } catch {
        /* init or end failed — nothing reliable to tear down */
      } finally {
        poolPromise = null;
      }
    },
    get,
    all,
    exec,
    crud,
  });
}

