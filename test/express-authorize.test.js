import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import express from "express";

import {
  Model,
  createSqlite3Adaptor,
  createExpressRestMiddleware,
} from "../src/index.js";

async function listenExpress(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, port });
    });
    server.once("error", reject);
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
  return new Promise((resolve, reject) => {
    if (body !== undefined) {
      const raw = JSON.stringify(body);
      opts.headers["Content-Type"] = "application/json";
      opts.headers["Content-Length"] = Buffer.byteLength(raw);
    }
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
    if (body !== undefined) {
      r.end(JSON.stringify(body));
    } else {
      r.end();
    }
  });
}

test("createExpressRestMiddleware: authorize protects API; unrelated paths skip", async () => {
  const db = createSqlite3Adaptor({ filename: ":memory:" });
  Model.useDB(db);

  const Tag = await Model.define({
    table: "express_gate_tags",
    fields: {
      id: { type: "number", primaryKey: true },
      name: { type: "char", max_length: 32 },
    },
  });
  await db.ensureTable(Tag);

  let guarded = 0;
  function gate(req, res, next) {
    guarded++;
    if (req.get("x-allow") !== "yes") {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  }

  const app = express();
  app.use(express.json());
  app.use(
    await createExpressRestMiddleware({
      backendPath: "/api",
      adminPath: "/model-site",
      serveFrontendDist: false,
      models: { tags: Tag },
      authorize: gate,
    }),
  );

  let sawPublic = false;
  app.use((req, res) => {
    if (req.path === "/public") sawPublic = true;
    res.status(404).json({ error: "Not found" });
  });

  const { server, port } = await listenExpress(app);

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
  } finally {
    server.close();
    await db.close?.();
  }
});
