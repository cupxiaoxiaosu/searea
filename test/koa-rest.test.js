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

function req(port, path, { method = "GET", body, headers = {} } = {}) {
  const opts = {
    hostname: "127.0.0.1",
    port,
    path,
    method,
    headers: { ...headers },
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
        resolve({ status: res.statusCode, headers: res.headers, body: json ?? text });
      });
    });
    r.on("error", reject);
    if (body !== undefined) r.end(JSON.stringify(body));
    else r.end();
  });
}

test("Koa REST middleware: CRUD schools + students", async (t) => {
  const db = createSqlite3Adaptor({ filename: ":memory:" });
  Model.useDB(db);

  const School = await Model.define({
    table: "schools",
    fields: {
      id: { type: "number", primaryKey: true },
      name: { type: "char", max_length: 255 },
      address: { type: "char", max_length: 255, null: true },
      size: { type: "number" },
    },
  });

  const Student = await Model.define({
    table: "students",
    fields: {
      id: { type: "number", primaryKey: true },
      name: { type: "char", max_length: 255 },
      age: { type: "number" },
      school: { type: "fk", relatedModel: School },
    },
  });

  await db.ensureTable(School);
  await db.ensureTable(Student);

  const app = new Koa();
  app.use(bodyParser());
  app.use(
    await createKoaRestMiddleware({
      backendPath: "/api",
      models: { schools: School, students: Student },
    })
  );

  const { server, port } = await listen(app);

  try {
    let res = await req(port, "/api/schools");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, []);

    res = await req(port, "/api/schools", {
      method: "POST",
      body: { name: "S1", address: "A1", size: 100 },
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.name, "S1");
    assert.equal(res.body.id, 1);

    res = await req(port, "/api/schools/1");
    assert.equal(res.status, 200);
    assert.equal(res.body.name, "S1");

    res = await req(port, "/api/schools/1", {
      method: "PATCH",
      body: { size: 999 },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.size, 999);

    res = await req(port, "/api/students", {
      method: "POST",
      body: { name: "Kid", age: 10, school: 1 },
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.school_id, 1);

    res = await req(port, "/api/students");
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 1);
    assert.equal(res.body[0].school_id, 1);
    assert.equal(res.body[0].school, undefined);

    res = await req(port, "/api/students?expand=school");
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 1);
    assert.equal(res.body[0].school_id, undefined);
    assert.equal(res.body[0].school?.id, 1);
    assert.equal(res.body[0].school?.name, "S1");

    res = await req(port, "/api/students/1?expand=school");
    assert.equal(res.status, 200);
    assert.equal(res.body.school_id, undefined);
    assert.deepEqual(res.body.school, { id: 1, name: "S1", address: "A1", size: 999 });

    res = await req(port, "/api/students?expand=notAnFkField");
    assert.equal(res.status, 200);
    assert.equal(res.body[0].school_id, 1);
    assert.equal(res.body[0].school, undefined);

    res = await req(port, "/api/schools/1?expand=school");
    assert.equal(res.status, 200);
    assert.equal(res.body.name, "S1");

    res = await req(port, "/api/schools/999");
    assert.equal(res.status, 404);

    res = await req(port, "/api/students/1", { method: "DELETE" });
    assert.equal(res.status, 204);

    res = await req(port, "/api/schools/1", { method: "DELETE" });
    assert.equal(res.status, 204);

    res = await req(port, "/api/schools/1");
    assert.equal(res.status, 404);
  } finally {
    server.close();
    await db.close?.();
  }
});

test("Koa REST events: on* triggers + return overrides body", async (t) => {
  const db = createSqlite3Adaptor({ filename: ":memory:" });
  Model.useDB(db);

  const Item = await Model.define({
    table: "event_items",
    fields: {
      id: { type: "number", primaryKey: true },
      name: { type: "char", max_length: 255 },
    },
  });
  await db.ensureTable(Item);

  const calls = [];
  const events = {
    event_items: {
      onPost: ({ instance }) => {
        calls.push(["onPost", instance.id, instance.name]);
      },
      onGetList: ({ instance }) => {
        const n = Array.isArray(instance)
          ? instance.length
          : instance && typeof instance === "object" && "items" in instance
            ? instance.items.length
            : -1;
        calls.push(["onGetList", n]);
      },
      onGetItem: ({ instance }) => {
        calls.push(["onGetItem", instance.id]);
        return { wrapped: { id: instance.id, name: instance.name }, by: "onGetItem" };
      },
      onPatch: ({ instance }) => {
        calls.push(["onPatch", instance.id, instance.name]);
      },
      onDelete: ({ instance }) => {
        calls.push(["onDelete", instance.id, instance.name]);
        return { ok: true, deleted: instance.id };
      },
    },
  };

  const app = new Koa();
  app.use(bodyParser());
  app.use(await createKoaRestMiddleware({ backendPath: "/api", models: { event_items: Item }, events }));

  const { server, port } = await listen(app);
  try {
    let res = await req(port, "/api/event_items", { method: "POST", body: { name: "A" } });
    assert.equal(res.status, 201);
    assert.equal(res.body.id, 1);
    assert.equal(res.body.name, "A");

    res = await req(port, "/api/event_items/1");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { wrapped: { id: 1, name: "A" }, by: "onGetItem" });

    res = await req(port, "/api/event_items?page=1&pageSize=10");
    assert.equal(res.status, 200);
    assert.equal(res.body.items.length, 1);
    assert.equal(res.body.items[0].name, "A");

    res = await req(port, "/api/event_items/1", { method: "PATCH", body: { name: "B" } });
    assert.equal(res.status, 200);
    assert.equal(res.body.name, "B");

    res = await req(port, "/api/event_items/1", { method: "DELETE" });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true, deleted: 1 });

    res = await req(port, "/api/event_items/1");
    assert.equal(res.status, 404);

    assert.deepEqual(calls, [
      ["onPost", 1, "A"],
      ["onGetItem", 1],
      ["onGetList", 1],
      ["onPatch", 1, "B"],
      ["onDelete", 1, "B"],
    ]);
  } finally {
    server.close();
    await db.close?.();
  }
});

test("Koa REST pagination does not fail on dangling FK rows", async () => {
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
      name: { type: "char", max_length: 255 },
      district: { type: "fk", relatedModel: District },
    },
  });

  await db.ensureTable(District);
  await db.ensureTable(School);

  // Create a row with a dangling FK on purpose (no DB-level FK constraint in v1).
  await School.objects.create({ name: "Broken School", district: 999 });

  const app = new Koa();
  app.use(bodyParser());
  app.use(
    await createKoaRestMiddleware({
      backendPath: "/api",
      models: { districts: District, schools: School },
    })
  );

  const { server, port } = await listen(app);
  try {
    const res = await req(port, "/api/schools?page=1&pageSize=20");
    assert.equal(res.status, 200);
    assert.equal(Array.isArray(res.body.items), true);
    assert.equal(res.body.items.length, 1);
    assert.equal(res.body.items[0].name, "Broken School");
    assert.equal(res.body.items[0].district, null);
  } finally {
    server.close();
    await db.close?.();
  }
});

test("Koa REST: pattern + choices validation (400 validation_failed)", async () => {
  const db = createSqlite3Adaptor({ filename: ":memory:" });
  Model.useDB(db);

  const Widget = await Model.define({
    table: "widgets",
    fields: {
      id: { type: "number", primaryKey: true },
      code: { type: "char", max_length: 8, pattern: "^[ABC]$" },
      status: {
        type: "char",
        max_length: 8,
        choices: [
          { value: "on", label: "On" },
          { value: "off", label: "Off" },
        ],
      },
      mode: {
        type: "number",
        choices: [
          { value: 0, label: "Easy" },
          { value: 1, label: "Hard" },
        ],
      },
    },
  });

  await db.ensureTable(Widget);

  const app = new Koa();
  app.use(bodyParser());
  app.use(await createKoaRestMiddleware({ backendPath: "/api", models: { widgets: Widget } }));

  const { server, port } = await listen(app);
  try {
    let res = await req(port, "/api/widgets", {
      method: "POST",
      body: { code: "A", status: "on", mode: 0 },
    });
    assert.equal(res.status, 201);

    res = await req(port, "/api/widgets", {
      method: "POST",
      body: { code: "B", status: "on", mode: 1 },
    });
    assert.equal(res.status, 201);

    res = await req(port, "/api/widgets", {
      method: "POST",
      body: { code: "Z", status: "on", mode: 0 },
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "validation_failed");
    assert.ok(Array.isArray(res.body.details));
    assert.ok(res.body.details.some((d) => d.field === "code" && d.code === "pattern_mismatch"));

    res = await req(port, "/api/widgets", {
      method: "POST",
      body: { code: "B", status: "bad", mode: 0 },
    });
    assert.equal(res.status, 400);
    assert.ok(res.body.details.some((d) => d.field === "status" && d.code === "invalid_choice"));

    res = await req(port, "/api/widgets", {
      method: "POST",
      body: { code: "C", status: "off", mode: 99 },
    });
    assert.equal(res.status, 400);
    assert.ok(res.body.details.some((d) => d.field === "mode" && d.code === "invalid_choice"));

    res = await req(port, "/api/widgets?status=on");
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 2);

    res = await req(port, "/api/widgets?status=nope");
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "validation_failed");
    assert.ok(res.body.details.some((d) => d.field === "status"));

    res = await req(port, "/api/widgets/2", { method: "PATCH", body: { mode: 1 } });
    assert.equal(res.status, 200);
    assert.equal(res.body.mode, 1);

    res = await req(port, "/api/widgets/2", { method: "PATCH", body: { mode: 9 } });
    assert.equal(res.status, 400);
  } finally {
    server.close();
    await db.close?.();
  }
});

test("createKoaRestMiddleware: authorize protects API; other paths skip guard", async () => {
  const db = createSqlite3Adaptor({ filename: ":memory:" });
  Model.useDB(db);

  const Tag = await Model.define({
    table: "gate_tags",
    fields: {
      id: { type: "number", primaryKey: true },
      name: { type: "char", max_length: 32 },
    },
  });
  await db.ensureTable(Tag);

  let guarded = 0;
  async function gate(ctx, next) {
    guarded++;
    if (ctx.get("x-allow") !== "yes") {
      ctx.status = 403;
      ctx.body = { error: "Forbidden" };
      return;
    }
    await next();
  }

  const app = new Koa();
  app.use(bodyParser());
  app.use(
    await createKoaRestMiddleware({
      backendPath: "/api",
      adminPath: "/model-site",
      serveFrontendDist: false,
      models: { tags: Tag },
      authorize: gate,
    }),
  );

  let sawPublic = false;
  app.use(async (ctx) => {
    if (ctx.path === "/public") sawPublic = true;
    ctx.status = 404;
  });

  const { server, port } = await listen(app);

  try {
    let res = await req(port, "/api/tags");
    assert.equal(res.status, 403);
    assert.equal(guarded, 1);

    res = await req(port, "/api/tags", { headers: { "x-allow": "yes" } });
    assert.equal(res.status, 200);
    assert.equal(guarded, 2);

    guarded = 0;
    await req(port, "/public");
    assert.equal(guarded, 0);
    assert.equal(sawPublic, true);

    guarded = 0;
    await req(port, "/model-site/");
    assert.equal(guarded, 1);

    guarded = 0;
    await req(port, "/model-site/", { headers: { "x-allow": "yes" } });
    assert.equal(guarded, 1);
  } finally {
    server.close();
    await db.close?.();
  }
});
