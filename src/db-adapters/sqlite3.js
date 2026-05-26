import fs from "node:fs";
import path from "node:path";

import sqlite3 from "sqlite3";

import { buildWhere, createFieldToSqlMapper, resolveSqlLogger } from "./_common.js";

function quoteIdent(name) {
  // Minimal identifier quoting for SQLite.
  return `"${String(name).replaceAll('"', '""')}"`;
}

const mapFieldToSql = createFieldToSqlMapper({ dialect: "sqlite", quoteIdent });

/**
 * SQLite 后端。若 **`filename`** 为磁盘路径，会在打开前 **`mkdir -p`** 父目录；
 * 库文件在首次打开时由驱动创建（等价于「没有则建新库」）。
 *
 * @param {{
 *   filename?: string,
 *   logSql?: boolean | ((info: { sql: string, params: unknown[], dialect?: string }) => void)
 * }} [opts]
 */
export function createSqlite3Adaptor(opts = {}) {
  const filename = opts?.filename ?? ":memory:";
  const log = resolveSqlLogger({ logSql: opts?.logSql, dialect: "sqlite" });

  let resolved = filename;
  if (filename !== ":memory:") {
    resolved = path.resolve(filename);
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  const db = new sqlite3.Database(resolved);

  const run = (sql, params = []) => {
    log?.(sql, params);
    return new Promise((resolve, reject) => {
      db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  };

  const get = (sql, params = []) => {
    log?.(sql, params);
    return new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row ?? null);
      });
    });
  };

  const all = (sql, params = []) => {
    log?.(sql, params);
    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows ?? []);
      });
    });
  };

  const exec = (sql) => {
    log?.(sql, []);
    return new Promise((resolve, reject) => {
      db.exec(sql, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  };

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

    await exec(
      `CREATE TABLE IF NOT EXISTS ${quoteIdent(table)} (${columnsSql.join(", ")})`
    );
  }

  return {
    dialect: "sqlite",
    async close() {
      await new Promise((resolve, reject) => db.close((e) => (e ? reject(e) : resolve())));
    },

    async rawGet(sql, params = []) {
      return await get(sql, params);
    },

    async rawAll(sql, params = []) {
      return await all(sql, params);
    },

    async exec(sql) {
      await exec(sql);
    },

    ensureTable,

    async insert(table, attrs) {
      const keys = Object.keys(attrs);
      if (keys.length === 0) {
        const res = await run(`INSERT INTO ${quoteIdent(table)} DEFAULT VALUES`);
        return { id: res.lastID };
      }

      const cols = keys.map(quoteIdent).join(", ");
      const placeholders = keys.map(() => "?").join(", ");
      const params = keys.map((k) => attrs[k]);
      const res = await run(`INSERT INTO ${quoteIdent(table)} (${cols}) VALUES (${placeholders})`, params);
      return { ...attrs, id: res.lastID };
    },

    async select(table, where = {}, { limit, offset } = {}) {
      const w = buildWhere(quoteIdent, where);
      let sql = `SELECT * FROM ${quoteIdent(table)} ${w.sql}`;
      if (typeof limit === "number") sql += ` LIMIT ${limit}`;
      if (typeof offset === "number") sql += ` OFFSET ${offset}`;
      return await all(sql, w.params);
    },

    async count(table, where = {}) {
      const w = buildWhere(quoteIdent, where);
      const row = await get(`SELECT COUNT(*) AS cnt FROM ${quoteIdent(table)} ${w.sql}`, w.params);
      return Number(row?.cnt ?? 0);
    },

    async sum(table, column, where = {}) {
      const w = buildWhere(quoteIdent, where);
      const row = await get(
        `SELECT SUM(${quoteIdent(column)}) AS agg FROM ${quoteIdent(table)} ${w.sql}`,
        w.params
      );
      const v = row?.agg;
      if (v == null) return null;
      return Number(v);
    },

    async avg(table, column, where = {}) {
      const w = buildWhere(quoteIdent, where);
      const row = await get(
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
      const res = await run(
        `UPDATE ${quoteIdent(table)} SET ${setSql} ${w.sql}`,
        [...setParams, ...w.params]
      );
      return res.changes;
    },

    async delete(table, where) {
      const w = buildWhere(quoteIdent, where);
      const res = await run(`DELETE FROM ${quoteIdent(table)} ${w.sql}`, w.params);
      return res.changes;
    },
  };
}

