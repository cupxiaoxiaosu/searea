import test from "node:test";
import assert from "node:assert/strict";

import { Model } from "../src/core/model.js";
import { createSqlite3Adaptor } from "../src/db-adapters/sqlite3.js";

function freshMemoryDb() {
  return createSqlite3Adaptor({ filename: ":memory:" });
}

test("ORM: 硬编码合法值 — create / get / filter 成功（pattern + char choices + number choices）", async () => {
  const db = freshMemoryDb();
  Model.useDB(db);
  const M = await Model.define({
    table: "orm_pattern_choices",
    fields: {
      id: { type: "number", primaryKey: true },
      phone: { type: "char", max_length: 20, pattern: "^\\d{3}$" },
      status: {
        type: "char",
        max_length: 4,
        choices: [
          { value: "A", label: "开启" },
          { value: "B", label: "关闭" },
        ],
      },
      flag: {
        type: "number",
        choices: [
          { value: 0, label: "否" },
          { value: 1, label: "是" },
        ],
      },
    },
  });
  await db.ensureTable(M);

  const created = await M.objects.create({
    phone: "123",
    status: "B",
    flag: 0,
  });
  assert.equal(created.phone, "123");
  assert.equal(created.status, "B");
  assert.equal(created.flag, 0);

  const got = await M.objects.get({ id: created.id });
  assert.equal(got.phone, "123");
  assert.equal(got.status, "B");
  assert.equal(got.flag, 0);

  const rows = await M.objects.filter({ status: "B", flag: 0 }).values({ fkDepth: 0 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].phone, "123");
});

test("ORM: 硬编码合法值 — 同字段 pattern 与 choices 同时满足时可写入", async () => {
  const db = freshMemoryDb();
  Model.useDB(db);
  const M = await Model.define({
    table: "orm_pc_combo",
    fields: {
      id: { type: "number", primaryKey: true },
      tier: {
        type: "char",
        max_length: 4,
        pattern: "^[XY]$",
        choices: [
          { value: "X", label: "档 X" },
          { value: "Y", label: "档 Y" },
        ],
      },
    },
  });
  await db.ensureTable(M);

  const row = await M.objects.create({ tier: "Y" });
  assert.equal(row.tier, "Y");
  const again = await M.objects.get({ id: row.id });
  assert.equal(again.tier, "Y");
});
