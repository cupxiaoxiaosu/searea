import mysql from "mysql2/promise";

import { buildWhere, createFieldToSqlMapper, resolveSqlLogger } from "./_common.js";

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
    const [rows] = await pool.query(sql, params);
    return rows;
  }

  async function execSql(sql) {
    log?.(sql, []);
    const pool = await getPool();
    await pool.query(sql);
  }

  async function ensureTable(modelClass) {
    const table = modelClass.table;
    const fields = modelClass.fields ?? {};
    if (!table) throw new Error("Model.table is required");

    const columnsSql = Object.entries(fields).map(([name, def]) => {
      return `${quoteIdent(name)} ${mapFieldToSql(def)}`;
    });
    if (columnsSql.length === 0) {
      throw new Error(`Model ${modelClass.name} must define at least 1 field`);
    }

    await execSql(
      `CREATE TABLE IF NOT EXISTS ${quoteIdent(table)} (${columnsSql.join(", ")}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`
    );
  }

  return {
    dialect: "mysql",
    async close() {
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

    async rawGet(sql, params = []) {
      const rows = await query(sql, params);
      return Array.isArray(rows) ? (rows[0] ?? null) : null;
    },

    async rawAll(sql, params = []) {
      const rows = await query(sql, params);
      return Array.isArray(rows) ? rows : [];
    },

    async exec(sql) {
      await execSql(sql);
    },

    ensureTable,

    async insert(table, attrs) {
      const keys = Object.keys(attrs);
      if (keys.length === 0) {
        const res = await query(`INSERT INTO ${quoteIdent(table)} () VALUES ()`);
        const insertId = res && typeof res === "object" && "insertId" in res ? res.insertId : null;
        return insertId == null ? {} : { id: insertId };
      }

      const cols = keys.map(quoteIdent).join(", ");
      const placeholders = keys.map(() => "?").join(", ");
      const params = keys.map((k) => attrs[k]);

      const res = await query(`INSERT INTO ${quoteIdent(table)} (${cols}) VALUES (${placeholders})`, params);
      const insertId = res && typeof res === "object" && "insertId" in res ? res.insertId : null;
      if (insertId == null) return { ...attrs };
      return { ...attrs, id: insertId };
    },

    async select(table, where = {}, { limit, offset } = {}) {
      const w = buildWhere(quoteIdent, where);
      let sql = `SELECT * FROM ${quoteIdent(table)} ${w.sql}`;
      if (typeof limit === "number") sql += ` LIMIT ${limit}`;
      if (typeof offset === "number") sql += ` OFFSET ${offset}`;
      return await this.rawAll(sql, w.params);
    },

    async count(table, where = {}) {
      const w = buildWhere(quoteIdent, where);
      const row = await this.rawGet(`SELECT COUNT(*) AS cnt FROM ${quoteIdent(table)} ${w.sql}`, w.params);
      return Number(row?.cnt ?? 0);
    },

    async sum(table, column, where = {}) {
      const w = buildWhere(quoteIdent, where);
      const row = await this.rawGet(
        `SELECT SUM(${quoteIdent(column)}) AS agg FROM ${quoteIdent(table)} ${w.sql}`,
        w.params
      );
      const v = row?.agg;
      if (v == null) return null;
      return Number(v);
    },

    async avg(table, column, where = {}) {
      const w = buildWhere(quoteIdent, where);
      const row = await this.rawGet(
        `SELECT AVG(${quoteIdent(column)}) AS agg FROM ${quoteIdent(table)} ${w.sql}`,
        w.params
      );
      const v = row?.agg;
      if (v == null) return null;
      return Number(v);
    },

    async update(table, where, attrs) {
      const setKeys = Object.keys(attrs);
      const setSql = setKeys.map((k) => `${quoteIdent(k)} = ?`).join(", ");
      const setParams = setKeys.map((k) => attrs[k]);
      const w = buildWhere(quoteIdent, where);
      const res = await query(
        `UPDATE ${quoteIdent(table)} SET ${setSql} ${w.sql}`,
        [...setParams, ...w.params]
      );
      return Number(res?.affectedRows ?? 0);
    },

    async delete(table, where) {
      const w = buildWhere(quoteIdent, where);
      const res = await query(`DELETE FROM ${quoteIdent(table)} ${w.sql}`, w.params);
      return Number(res?.affectedRows ?? 0);
    },
  };
}
