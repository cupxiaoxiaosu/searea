// @ts-nocheck
/**
 * JSX DSL → compileSchema → computeSchemaDiff / applySchemaMigration（真实 MySQL）。
 *
 * - 每个文件运行周期建库：`searea-test-${timestamp}`（基线 schools JSX 为 `schoolV0`）。
 * - 各用例开头 `resetToV0`：表结构回到 V0，再与目标 schema 做 diff（互不依赖执行顺序）。
 * - 运行：`npm test`（需本机 MySQL；无库时可用 `SKIP_MYSQL_JSX_TESTS=1 npm test` 跳过本文件）。
 * - 默认 127.0.0.1:3307 root/root。
 *
 * 环境变量：MYSQL_HOST、MYSQL_PORT、MYSQL_USER、MYSQL_PASSWORD。
 */
/** @jsxImportSource ../src/schema */

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import mysql from "mysql2/promise";

import { createMysqlAdaptor } from "../src/db-adapters/mysql.js";
import { Model } from "../src/core/model.js";
import {
  applySchemaMigration,
  computeSchemaDiff,
} from "../src/server-adapters/core/schema-diff.js";
import { compileSchema } from "../src/schema/compile.js";
import { Database, Table, CharField, IntegerField } from "../src/schema/components.js";

const MYSQL_CONNECT = {
  host: process.env.MYSQL_HOST ?? "127.0.0.1",
  port: Number(process.env.MYSQL_PORT ?? 3307),
  user: process.env.MYSQL_USER ?? "root",
  password: process.env.MYSQL_PASSWORD ?? "root",
};

/** schoolV0：仅 `schools`，id + name(255 非空)。 */
const schoolV0 = (
  <Database>
    <Table name="schools">
      <IntegerField name="id" primaryKey label="主键" />
      <CharField name="name" maxLength={255} label="名称" />
    </Table>
  </Database>
);

/** schoolV1：schools 增加 `size`（int，默认 0）。 */
const schoolV1 = (
  <Database>
    <Table name="schools">
      <IntegerField name="id" primaryKey />
      <CharField name="name" maxLength={128} />
      <IntegerField name="size" defaultValue={0} />
    </Table>
  </Database>
);

/** schoolV2：在 schoolV1 基础上收紧 `name`（128 + 可空）。 */
const schoolV2 = (
  <Database>
    <Table name="schools">
      <IntegerField name="id" primaryKey />
      <CharField name="name" maxLength={128} null />
      <IntegerField name="size" defaultValue={0} />
    </Table>
  </Database>
);

/** schoolV1 的 schools + 新建 `teachers`（缺表迁移）。schools 列集与 schoolV1 一致。 */
const schoolV1_withTeachers = (
  <Database>
    <Table name="schools">
      <IntegerField name="id" primaryKey />
      <CharField name="name" maxLength={255} />
      <IntegerField name="size" defaultValue={0} />
    </Table>
    <Table name="teachers">
      <IntegerField name="id" primaryKey />
      <CharField name="label" maxLength={64} />
    </Table>
  </Database>
);

const SKIP_MYSQL_JSX = process.env.SKIP_MYSQL_JSX_TESTS === "1";

describe(
  "schema-diff evolution jsx (mysql)",
  { skip: SKIP_MYSQL_JSX },
  () => {
/** 本次运行的临时库名（同一时间戳，全文件共用）。 */
let dbName = "";
let db;
let modelsV0 = null;

function adminConnection() {
  return mysql.createConnection({ ...MYSQL_CONNECT });
}

before(async () => {
  dbName = `searea-test-${Date.now()}`;
  const admin = await adminConnection();
  await admin.query(
    `CREATE DATABASE \`${dbName.replace(/`/g, "")}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await admin.end();

  db = createMysqlAdaptor({ ...MYSQL_CONNECT, database: dbName.replace(/`/g, "") });
  Model.useDB(db);

  const compiled = await compileSchema(schoolV0);
  modelsV0 = compiled.models;
  await resetToV0();
});

after(async () => {
  Model.useDB(null);
  if (db) await db.close().catch(() => {});
  if (dbName) {
    const c = await mysql.createConnection(MYSQL_CONNECT);
    try {
      // 收尾：单行语义即 DROP DATABASE IF EXISTS（删本次临时库）。
      await c.query(`DROP DATABASE IF EXISTS \`${dbName.replace(/`/g, "")}\``);
    } finally {
      await c.end().catch(() => {});
    }
  }
});

/** 将库内演进相关表删掉并重新建 V0：`schools`（及测试中可能出现的 `teachers`）。 */
async function resetToV0() {
  if (!db || !modelsV0) throw new Error("resetToV0: db/modelsV0 not ready");
  await db.exec("SET FOREIGN_KEY_CHECKS=0");
  await db.exec("DROP TABLE IF EXISTS `teachers`");
  await db.exec("DROP TABLE IF EXISTS `schools`");
  await db.exec("SET FOREIGN_KEY_CHECKS=1");
  await db.ensureTable(modelsV0.schools);
}

test("V0", async () => {
  await resetToV0();

  const baseline = await computeSchemaDiff({
    db,
    models: modelsV0,
  });

  const schools = baseline.tables.find((t) => t.resourceKey === "schools");
  assert.deepEqual(schools?.serverSql?.migrationSql ?? [], []);
  assert.equal(schools?.exists, true);
  const drift =
    (schools?.diff?.missingColumns?.length ?? 0) +
    (schools?.diff?.changedColumns?.length ?? 0) +
    (schools?.diff?.extraColumns?.length ?? 0);
  const driftSql = [];
  for (const t of baseline.tables ?? []) {
    for (const sql of t.serverSql?.migrationSql ?? []) driftSql.push(sql);
  }
  const driftMsg = "基线 schools（id+name）与 DB 仍不一致（不应有 drift）";
  assert.equal(
    drift,
    0,
    driftSql.length ? `${driftMsg}\n${driftSql.join("\n")}` : driftMsg
  );
});

test("V1", async () => {
  await resetToV0();

  const { models } = await compileSchema(schoolV1);

  const diffBefore = await computeSchemaDiff({
    db,
    models,
  });
  const schoolsBefore = diffBefore.tables.find((t) => t.resourceKey === "schools");
  assert.deepEqual(schoolsBefore?.serverSql?.migrationSql, [
    "ALTER TABLE `schools` ADD COLUMN `size` BIGINT NOT NULL DEFAULT 0;",
    "ALTER TABLE `schools` MODIFY COLUMN `name` VARCHAR(128) NOT NULL;",
  ]);

  await applySchemaMigration({
    db,
    diff: diffBefore,
  });
  const diffAfter = await computeSchemaDiff({ db, models });
  const schoolsAfter = diffAfter.tables.find((t) => t.resourceKey === "schools");
  assert.deepEqual(schoolsAfter?.serverSql?.migrationSql ?? [], []);
});

test("V2", async () => {
  await resetToV0();

  const { models } = await compileSchema(schoolV2);
  const diffBefore = await computeSchemaDiff({ db, models });
  const schoolsBefore = diffBefore.tables.find((t) => t.resourceKey === "schools");
  assert.deepEqual(schoolsBefore?.serverSql?.migrationSql, [
    "ALTER TABLE `schools` ADD COLUMN `size` BIGINT NOT NULL DEFAULT 0;",
    "ALTER TABLE `schools` MODIFY COLUMN `name` VARCHAR(128) NULL;",
  ]);

  await applySchemaMigration({ db, diff: diffBefore });
  const diffAfter = await computeSchemaDiff({ db, models });
  const schoolsAfter = diffAfter.tables.find((t) => t.resourceKey === "schools");
  assert.deepEqual(schoolsAfter?.serverSql?.migrationSql ?? [], []);
});

test("V3", async () => {
  await resetToV0();

  const { models } = await compileSchema(schoolV1_withTeachers);
  const diffBefore = await computeSchemaDiff({ db, models });
  const schoolsBefore = diffBefore.tables.find((t) => t.resourceKey === "schools");
  assert.deepEqual(schoolsBefore?.serverSql?.migrationSql, [
    "ALTER TABLE `schools` ADD COLUMN `size` BIGINT NOT NULL DEFAULT 0;",
  ]);
  const teachersBefore = diffBefore.tables.find((t) => t.resourceKey === "teachers");
  assert.deepEqual(teachersBefore?.serverSql?.migrationSql, [
    "CREATE TABLE `teachers` (`id` BIGINT PRIMARY KEY AUTO_INCREMENT, `label` VARCHAR(64) NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;",
  ]);

  await applySchemaMigration({ db, diff: diffBefore });

  const diffAfter = await computeSchemaDiff({ db, models });
  const schoolsAfter = diffAfter.tables.find((t) => t.resourceKey === "schools");
  assert.deepEqual(schoolsAfter?.serverSql?.migrationSql ?? [], []);
  const teachersAfter = diffAfter.tables.find((t) => t.resourceKey === "teachers");
  assert.deepEqual(teachersAfter?.serverSql?.migrationSql ?? [], []);
});
});
