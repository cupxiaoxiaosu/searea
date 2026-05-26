/**
 * Recipes pocket demo — Koa + Searea ORM（仅 C 端展示，无登录/发布）。
 *
 *   npm run example:demo:recipes
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Koa from "koa";
import bodyParser from "koa-bodyparser";
import { tsImport } from "tsx/esm/api";

import { Model, createSqlite3Adaptor, createKoaRestMiddleware, compileSchema } from "searea";

import { seedRecipeDemo } from "./seed.mjs";

const MIME = {
  ".html": "text/html;charset=utf-8",
  ".css": "text/css;charset=utf-8",
  ".js": "application/javascript;charset=utf-8",
  ".svg": "image/svg+xml",
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootPublic = path.join(__dirname, "public");

const port = Number(process.env.PORT) || 3762;
const backendPath = "/api";

const dbPath = path.join(__dirname, "demo-recipes.sqlite3");
const db = createSqlite3Adaptor({ filename: dbPath });
Model.useDB(db);

const schemaMod = await tsImport("./schema.tsx", import.meta.url);
const { models } = await compileSchema(schemaMod.default);

for (const M of Object.values(models)) {
  await db.ensureTable(M);
}

if (process.env.RECIPE_DEMO_RESET === "1") {
  await db.exec("DELETE FROM recipe_lines;");
  await db.exec("DELETE FROM recipes;");
  await db.exec("DELETE FROM chefs;");
}

const count = async (tbl) =>
  Number((await db.rawGet(`SELECT COUNT(*) AS c FROM ${tbl}`))?.c ?? 0);

if ((await count("chefs")) === 0) {
  await seedRecipeDemo(models);
}

async function protectChefsRoutes(ctx, next) {
  if (
    ctx.path === `${backendPath}/chefs` ||
    ctx.path.startsWith(`${backendPath}/chefs/`)
  ) {
    ctx.status = 404;
    ctx.body = { error: "Not found" };
    return;
  }
  return next();
}

const restMw = await createKoaRestMiddleware({
  models,
  backendPath,
  serveFrontendDist: false,
});

const app = new Koa();
app.use(bodyParser());
app.use(protectChefsRoutes);
app.use(restMw);
app.use(async (ctx) => {
  if (ctx.path.startsWith(backendPath)) {
    ctx.status = 404;
    ctx.body = { error: "Not found" };
    return;
  }
  try {
    const rel = ctx.path === "/" ? "index.html" : ctx.path.replace(/^\//, "");
    const safe = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, "");
    const full = path.join(rootPublic, safe);
    if (!full.startsWith(rootPublic)) {
      ctx.status = 403;
      return;
    }
    const stat = await fs.stat(full);
    const file = stat.isDirectory() ? path.join(full, "index.html") : full;
    ctx.type = MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
    ctx.body = await fs.readFile(file);
  } catch {
    ctx.status = 404;
    ctx.body = "Not found";
  }
});

app.listen(port, () => {
  const base = `http://127.0.0.1:${port}`;
  console.log(`[example:demo:recipes] ${base}`);
  console.log(`  UI   → ${base}/`);
  console.log(`  REST → ${base}${backendPath}/recipes`);
});
