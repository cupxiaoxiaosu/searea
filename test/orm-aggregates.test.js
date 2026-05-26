/**
 * ORM aggregate helpers: count (existing), sum / avg on number fields (SQL or in-memory fallback).
 *
 * 引擎（二选一）：
 * - 默认 SQLite（临时文件）。
 * - `ORM_AGGREGATES_ENGINE=mysql`：真实 MySQL；连接参数同 `test/model-jsx.test.tsx`
 *   （MYSQL_HOST、MYSQL_PORT、MYSQL_USER、MYSQL_PASSWORD；默认 127.0.0.1:3307 root/root）。
 *   每个用例独立临时库 `searea_agg_*`，结束后 DROP。
 *
 * 其它：
 * - `ORM_AGGREGATES_SILENT_SQL=1`：关闭 SQL 打印。
 * - 无 MySQL 时不要用 `ENGINE=mysql`，或设 `SKIP_MYSQL_AGGREGATE_TESTS=1` 跳过整文件（与 jsx 测试类似）。
 */
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import mysql from "mysql2/promise";

import { Model, createSqlite3Adaptor } from "../src/index.js";
import { createMysqlAdaptor } from "../src/db-adapters/mysql.js";

let dbCounter = 0;

const USE_MYSQL = process.env.ORM_AGGREGATES_ENGINE === "mysql";
const SKIP_FILE = USE_MYSQL && process.env.SKIP_MYSQL_AGGREGATE_TESTS === "1";

/** 运行本文件时默认在终端打印 ORM 触发的 SQL；全量测噪声大时设 ORM_AGGREGATES_SILENT_SQL=1 */
const logSqlInTests = process.env.ORM_AGGREGATES_SILENT_SQL !== "1";

const MYSQL_CONNECT = {
  host: process.env.MYSQL_HOST ?? "127.0.0.1",
  port: Number(process.env.MYSQL_PORT ?? 3307),
  user: process.env.MYSQL_USER ?? "root",
  password: process.env.MYSQL_PASSWORD ?? "root",
};

function safeMysqlIdent(name) {
  return String(name).replace(/`/g, "");
}

async function withDb(fn) {
  if (USE_MYSQL) {
    const dbName = safeMysqlIdent(
      `searea_agg_${process.pid}_${Date.now()}_${++dbCounter}`.replace(/[^a-zA-Z0-9_]/g, "_")
    );
    const admin = await mysql.createConnection({
      ...MYSQL_CONNECT,
      multipleStatements: false,
    });
    await admin.query(
      `CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    await admin.end();

    const db = createMysqlAdaptor({
      ...MYSQL_CONNECT,
      database: dbName,
      logSql: logSqlInTests ? true : false,
      ensureDatabase: false,
    });
    Model.useDB(db);
    try {
      return await fn(db);
    } finally {
      Model.useDB(null);
      await db.close().catch(() => {});
      const c = await mysql.createConnection({ ...MYSQL_CONNECT, multipleStatements: false });
      try {
        await c.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
      } finally {
        await c.end().catch(() => {});
      }
    }
  }

  const filename = path.join(
    process.cwd(),
    "test",
    `tmp-orm-agg-${process.pid}-${++dbCounter}.sqlite3`
  );
  await fs.rm(filename, { force: true });

  const db = createSqlite3Adaptor({ filename, logSql: logSqlInTests ? true : false });
  Model.useDB(db);

  try {
    return await fn(db);
  } finally {
    Model.useDB(null);
    await db.close();
    await fs.rm(filename, { force: true });
  }
}

async function defineInventoryModel(db) {
  const Item = await Model.define({
    table: "agg_items",
    fields: {
      id: { type: "number", primaryKey: true },
      name: { type: "char", max_length: 64 },
      qty: { type: "number", default: 0 },
      unit_price: { type: "number", default: 0 },
    },
  });
  await db.ensureTable(Item);
  return Item;
}

describe(
  `ORM aggregates (${USE_MYSQL ? "mysql" : "sqlite"})`,
  { skip: SKIP_FILE },
  () => {
    test("ORM aggregates: empty table count 0; sum/avg null", async () => {
      await withDb(async () => {
        const Item = await defineInventoryModel(Model.db);
        assert.equal(await Item.objects.all().count(), 0);
        assert.equal(await Item.objects.filter({ qty: { $gte: 0 } }).count(), 0);
        assert.equal(await Item.objects.all().sum("qty"), null);
        assert.equal(await Item.objects.all().avg("unit_price"), null);
      });
    });

    test("ORM aggregates: count, sum, avg with SQL pushdown (plain filter)", async () => {
      await withDb(async () => {
        const Item = await defineInventoryModel(Model.db);
        await Item.objects.create({ name: "a", qty: 10, unit_price: 2 });
        await Item.objects.create({ name: "b", qty: 5, unit_price: 4 });
        await Item.objects.create({ name: "c", qty: 20, unit_price: 1 });

        assert.equal(await Item.objects.all().count(), 3);
        assert.equal(await Item.objects.filter({ qty: { $gte: 10 } }).count(), 2);

        assert.equal(await Item.objects.all().sum("qty"), 35);
        assert.equal(await Item.objects.filter({ unit_price: { $lte: 2 } }).sum("qty"), 30);

        const avgPrice = await Item.objects.all().avg("unit_price");
        // MySQL 对整型列的 AVG 常按有限小数返回（如 2.3333），与 7/3 略有舍入差
        assert.ok(Math.abs(Number(avgPrice) - 7 / 3) < 0.001);

        const avgQtyHi = await Item.objects.filter({ qty: { $gte: 10 } }).avg("qty");
        assert.equal(avgQtyHi, 15);
      });
    });

    test("ORM aggregates: sum/avg with orderBy uses in-memory path", async () => {
      await withDb(async () => {
        const Item = await defineInventoryModel(Model.db);
        await Item.objects.create({ name: "x", qty: 1, unit_price: 10 });
        await Item.objects.create({ name: "y", qty: 2, unit_price: 20 });

        const qs = Item.objects.all().orderBy("-unit_price");
        assert.equal(await qs.sum("qty"), 3);
        const a = await qs.avg("qty");
        assert.equal(a, 1.5);
      });
    });

    test("ORM aggregates: sum respects limit (in-memory)", async () => {
      await withDb(async () => {
        const Item = await defineInventoryModel(Model.db);
        await Item.objects.create({ name: "a", qty: 100, unit_price: 1 });
        await Item.objects.create({ name: "b", qty: 1, unit_price: 1 });
        await Item.objects.create({ name: "c", qty: 1, unit_price: 1 });

        assert.equal(await Item.objects.all().orderBy("name").limit(2).sum("qty"), 101);
      });
    });

    test("ORM aggregates: exclude reduces rows before sum", async () => {
      await withDb(async () => {
        const Item = await defineInventoryModel(Model.db);
        await Item.objects.create({ name: "keep", qty: 5, unit_price: 1 });
        await Item.objects.create({ name: "drop", qty: 999, unit_price: 1 });

        assert.equal(
          await Item.objects
            .filter({ unit_price: 1 })
            .exclude({ name: "drop" })
            .sum("qty"),
          5
        );
      });
    });

    test("ORM aggregates: sum/avg reject unknown or non-number fields", async () => {
      await withDb(async () => {
        const Item = await defineInventoryModel(Model.db);
        await assert.rejects(
          () => Item.objects.all().sum("nope"),
          /unknown field "nope"/
        );
        await assert.rejects(
          () => Item.objects.all().avg("name"),
          /must have type "number"/
        );
      });
    });

    test("logSql captures ORM SQL and params", async () => {
      const entries = [];
      if (USE_MYSQL) {
        const dbName = safeMysqlIdent(
          `searea_agg_log_${process.pid}_${Date.now()}`.replace(/[^a-zA-Z0-9_]/g, "_")
        );
        const admin = await mysql.createConnection({
          ...MYSQL_CONNECT,
          multipleStatements: false,
        });
        await admin.query(
          `CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
        );
        await admin.end();

        const db = createMysqlAdaptor({
          ...MYSQL_CONNECT,
          database: dbName,
          logSql: ({ sql, params }) => entries.push({ sql, params: [...params] }),
          ensureDatabase: false,
        });
        Model.useDB(db);
        try {
          const Item = await Model.define({
            table: "log_items",
            fields: {
              id: { type: "number", primaryKey: true },
              n: { type: "number", default: 0 },
            },
          });
          await db.ensureTable(Item);
          await Item.objects.create({ n: 7 });
          assert.equal(await Item.objects.filter({ n: { $gte: 0 } }).count(), 1);
          assert.ok(entries.some((e) => e.sql.includes("CREATE TABLE")));
          assert.ok(entries.some((e) => e.sql.includes("INSERT INTO")));
          assert.ok(entries.some((e) => e.sql.includes("COUNT(*)")));
        } finally {
          Model.useDB(null);
          await db.close().catch(() => {});
          const c = await mysql.createConnection({ ...MYSQL_CONNECT, multipleStatements: false });
          try {
            await c.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
          } finally {
            await c.end().catch(() => {});
          }
        }
      } else {
        const db = createSqlite3Adaptor({
          filename: ":memory:",
          logSql: ({ sql, params }) => entries.push({ sql, params: [...params] }),
        });
        Model.useDB(db);
        try {
          const Item = await Model.define({
            table: "log_items",
            fields: {
              id: { type: "number", primaryKey: true },
              n: { type: "number", default: 0 },
            },
          });
          await db.ensureTable(Item);
          await Item.objects.create({ n: 7 });
          assert.equal(await Item.objects.filter({ n: { $gte: 0 } }).count(), 1);
          assert.ok(entries.some((e) => e.sql.includes("CREATE TABLE")));
          assert.ok(entries.some((e) => e.sql.includes("INSERT INTO")));
          assert.ok(entries.some((e) => e.sql.includes("COUNT(*)")));
        } finally {
          Model.useDB(null);
          await db.close();
        }
      }
    });
  }
);
