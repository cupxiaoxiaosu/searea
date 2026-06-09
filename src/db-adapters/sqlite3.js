import fs from "node:fs";
import path from "node:path";

import sqlite3 from "sqlite3";

import { createAdapterMethods, createCrudMethods, createFieldToSqlMapper, resolveSqlLogger } from "./_common.js";

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

  const crud = createCrudMethods({
    quoteIdent,
    mapFieldToSql,
    exec,
    get,
    all,
    run,
    emptyInsertSql: (quotedTable) => `INSERT INTO ${quotedTable} DEFAULT VALUES`,
    formatInsertResult: (res, attrs) => ({ ...attrs, id: res.lastID }),
    updateChangeCount: (res) => res.changes,
    deleteChangeCount: (res) => res.changes,
  });

  return createAdapterMethods({
    dialect: "sqlite",
    close: async () => {
      await new Promise((resolve, reject) => db.close((e) => (e ? reject(e) : resolve())));
    },
    get,
    all,
    exec,
    crud,
  });
}

