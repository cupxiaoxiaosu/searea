import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import Koa from "koa";
import bodyParser from "koa-bodyparser";

import { Model, createSqlite3Adaptor, createKoaRestMiddleware } from "../src/index.js";

async function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

function req(port, path, { method = "GET", body } = {}) {
  const opts = {
    hostname: "127.0.0.1",
    port,
    path,
    method,
    headers: {},
  };
  if (body !== undefined) {
    const raw = JSON.stringify(body);
    opts.headers["Content-Type"] = "application/json";
    opts.headers["Content-Length"] = Buffer.byteLength(raw);
  }

  return new Promise((resolve, reject) => {
    const r = http.request(opts, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          json = text;
        }
        resolve({ status: res.statusCode, body: json ?? text });
      });
    });
    r.on("error", reject);
    if (body !== undefined) r.end(JSON.stringify(body));
    else r.end();
  });
}

test("Admin meta: models, meta, paged list, api-docs", async () => {
  const db = createSqlite3Adaptor({ filename: ":memory:" });
  Model.useDB(db);

  const District = await Model.define({
    table: "districts",
    fields: {
      id: { type: "number", primaryKey: true },
      name: { type: "char", max_length: 255 },
    },
  });

  const School = await Model.define({
    table: "schools",
    fields: {
      id: { type: "number", primaryKey: true },
      name: { type: "char", max_length: 255, label: "校名" },
      district: { type: "fk", relatedModel: District },
    },
  });

  await db.ensureTable(District);
  await db.ensureTable(School);

  await District.objects.create({ name: "A区" });
  await School.objects.create({ name: "S1", district: 1 });

  const app = new Koa();
  app.use(bodyParser());
  app.use(
    await createKoaRestMiddleware({
      backendPath: "/api",
      adminCatalog: [
        { key: "districts", modelName: "District", admin: { label: "区县", display_field: "name", order: 1 } },
        { key: "schools", modelName: "School", admin: { label: "学校", display_field: "name", order: 2 } },
      ],
      models: { districts: District, schools: School },
    })
  );

  const { server, port } = await listen(app);

  try {
    let res = await req(port, "/api/models");
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
    assert.equal(res.body.length, 2);
    assert.equal(res.body[0].key, "districts");
    assert.equal(res.body[1].admin.label, "学校");

    res = await req(port, "/api/schools/meta");
    assert.equal(res.status, 200);
    assert.equal(res.body.table, "schools");
    assert.equal(res.body.fields.name.label, "校名");
    assert.equal(res.body.fields.district.kind, "foreign_key");
    assert.equal(res.body.fields.district.target, "districts");
    assert.equal(res.body.fields.district.label, "district");
    assert.ok(Array.isArray(res.body.reverseRelations));
    const rev = res.body.reverseRelations.find((r) => r.sourceTable === "students");
    assert.equal(rev, undefined);

    res = await req(port, "/api/districts/meta");
    const revSchool = res.body.reverseRelations.find((r) => r.sourceTable === "schools");
    assert.ok(revSchool);
    assert.equal(revSchool.fkField, "district");

    res = await req(port, "/api/schools?page=1&pageSize=10");
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.items));
    assert.equal(res.body.total, 1);
    assert.equal(res.body.items[0].name, "S1");
    assert.ok(res.body.items[0].district && typeof res.body.items[0].district === "object");

    res = await req(port, "/api/api-docs");
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.models));
    assert.ok(res.body.models.some((m) => m.key === "schools"));

    res = await req(port, "/api/schools", { method: "PUT", body: { name: "S1x", district: 1 } });
    assert.equal(res.status, 405);

    res = await req(port, "/api/schools/1", { method: "PUT", body: { name: "S1-updated" } });
    assert.equal(res.status, 200);
    assert.equal(res.body.name, "S1-updated");
  } finally {
    server.close();
    await db.close?.();
  }
});

test("Admin meta: catalog from Model.admin when adminCatalog omitted", async () => {
  const db = createSqlite3Adaptor({ filename: ":memory:" });
  Model.useDB(db);

  const Student = await Model.define({
    table: "students",
    fields: {
      id: { type: "number", primaryKey: true },
      name: { type: "char", max_length: 255 },
    },
    admin: { label: "学生", display_field: "name", app: "campus", order: 4 },
  });
  await db.ensureTable(Student);
  await Student.objects.create({ name: "张三" });

  const app = new Koa();
  app.use(bodyParser());
  app.use(await createKoaRestMiddleware({ models: { students: Student } }));

  const { server, port } = await listen(app);
  try {
    const modelsRes = await req(port, "/api/models");
    assert.equal(modelsRes.status, 200);
    assert.equal(modelsRes.body[0].key, "students");
    assert.equal(modelsRes.body[0].admin.label, "学生");
    assert.equal(modelsRes.body[0].admin.order, 4);
  } finally {
    server.close();
    await db.close?.();
  }
});

test("Admin meta: pattern and choices on fields", async () => {
  const db = createSqlite3Adaptor({ filename: ":memory:" });
  Model.useDB(db);

  const Tag = await Model.define({
    table: "tags",
    fields: {
      id: { type: "number", primaryKey: true },
      slug: { type: "char", max_length: 16, pattern: "^[a-z]+$" },
      color: {
        type: "char",
        max_length: 8,
        choices: [
          { value: "red", label: "红" },
          { value: "blue", label: "蓝" },
        ],
      },
      level: {
        type: "number",
        choices: [
          { value: 1, label: "低" },
          { value: 2, label: "高" },
        ],
      },
    },
  });
  await db.ensureTable(Tag);

  const app = new Koa();
  app.use(bodyParser());
  app.use(await createKoaRestMiddleware({ backendPath: "/api", models: { tags: Tag } }));

  const { server, port } = await listen(app);
  try {
    const res = await req(port, "/api/tags/meta");
    assert.equal(res.status, 200);
    assert.equal(res.body.fields.slug.pattern, "^[a-z]+$");
    assert.equal(res.body.fields.color.choices.length, 2);
    assert.equal(res.body.fields.color.choices[0].value, "red");
    assert.equal(res.body.fields.level.choices[1].value, 2);
  } finally {
    server.close();
    await db.close?.();
  }
});
