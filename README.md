# Searea — Developer Guide (English)

**Searea** (package name `searea`) is a Django-style ORM for Node.js: `Model` / `QuerySet`, foreign keys and reverse accessors, optional **JSX** schema compilation, **SQLite** and **MySQL** adapters, and framework middleware (**Koa**, **Express**, **Egg**) that exposes REST CRUD, an admin-oriented model catalog, **`schema-diff`**, and **`schema-migrate`**. The optional **Admin SPA** (`src/frontend`) adds a **Postman-style API Explorer** and a **visual schema diff / migration console** (`/model-site/api-explorer`, `/model-site/schema-diff`) so you can exercise the same HTTP API without leaving the browser (**§8**).

This document is the **single** maintained English handbook. Implementation details below match the source tree under [`src/`](../src/), runnable demos under [`examples/tutorials/`](../examples/tutorials/), and tests under [`test/`](../test/).

---

## Table of contents

1. [Quick start — SQLite education system (School, Teacher, Student) + Koa](#1-quick-start--sqlite-education-system-school-teacher-student--koa)
2. [MySQL from scratch, `Model.define`, and JSX schema](#2-mysql-from-scratch-modeldefine-and-jsx-schema)
3. [Database tables, schema diff, and migrations](#3-database-tables-schema-diff-and-migrations)
4. [HTTP / REST relationships between tables](#4-http--rest-relationships-between-tables)
5. [Core ORM — execution model and API surface](#5-core-orm--execution-model-and-api-surface)
6. [SQLite and MySQL adapters](#6-sqlite-and-mysql-adapters)
7. [Express, Koa, and Egg](#7-express-koa-and-egg)
8. [Built-in Admin UI: API Explorer and schema migration](#8-built-in-admin-ui-api-explorer-and-schema-migration)
9. [About the author](#9-about-the-author)

---

## 1. Quick start — SQLite education system (School, Teacher, Student) + Koa

### 1.1 Goal and prerequisites

You will run a minimal **education** backend: **schools**, **teachers** (belonging to a school), **students** (belonging to a school and optionally a teacher), with **SQLite** persistence and **Koa** serving JSON REST under a configurable prefix (default **`/api`**).

- **Node.js** ≥ **18.18**
- **ESM** (`"type": "module"` in `package.json`)

### 1.2 Install

```bash
npm install searea koa koa-bodyparser
```

`searea` ships with `sqlite3` and `mysql2`. **Koa** is **not** a dependency of `searea`; your application must install it.

### 1.3 Mental model

1. **`createSqlite3Adaptor({ filename })`** → database handle with Searea’s ORM contract (`select`, `insert`, `update`, `delete`, `ensureTable`, `rawAll`, `rawGet`, `exec`, …).
2. **`Model.useDB(db)`** — registers the default DB for all models that do not override `db`.
3. **`await Model.define({ table, fields, ... })`** — returns a **concrete model class**. **Foreign keys** require the **referenced** model to exist first (`relatedModel` must be the class you already defined).
4. **`await db.ensureTable(ModelClass)`** — creates the physical table from `ModelClass.fields`. By default, **`Model.define` does not** create tables (`ensureTable: false` in [`src/core/model.js`](../src/core/model.js)); you either call `ensureTable` explicitly or pass **`ensureTable: true`** to `define` / `init`.
5. **`await createKoaRestMiddleware({ models })`** — mounts REST + admin helpers. **`models`** is an object **`{ [resourceKey]: ModelClass }`**; the **`resourceKey`** becomes the first URL segment (e.g. **`GET /api/students`**).

### 1.4 Full minimal example (SQLite + Koa)

The structure mirrors the campus demo in [`examples/tutorials/campus-shared/model-define.mjs`](../examples/tutorials/campus-shared/model-define.mjs) but stays self-contained:

```js
import Koa from "koa";
import bodyParser from "koa-bodyparser";
import { Model, createSqlite3Adaptor, createKoaRestMiddleware } from "searea";

const db = createSqlite3Adaptor({ filename: "./education.sqlite3" });
Model.useDB(db);

const School = await Model.define({
  table: "schools",
  admin: { label: "School", display_field: "name", order: 1 },
  fields: {
    id: { type: "number", primaryKey: true },
    name: { type: "char", max_length: 200, label: "Name" },
    address: { type: "text", null: true, label: "Address" },
  },
});

const Teacher = await Model.define({
  table: "teachers",
  admin: { label: "Teacher", display_field: "name", order: 2 },
  fields: {
    id: { type: "number", primaryKey: true },
    name: { type: "char", max_length: 128 },
    school: { type: "fk", relatedModel: School, label: "School" },
  },
});

const Student = await Model.define({
  table: "students",
  admin: { label: "Student", display_field: "name", order: 3 },
  fields: {
    id: { type: "number", primaryKey: true },
    name: { type: "char", max_length: 128 },
    school: { type: "fk", relatedModel: School },
    teacher: { type: "fk", relatedModel: Teacher, null: true },
  },
});

const models = {
  schools: School,
  teachers: Teacher,
  students: Student,
};

for (const ModelClass of Object.values(models)) {
  await db.ensureTable(ModelClass);
}

const app = new Koa();
app.use(bodyParser());
app.use(
  await createKoaRestMiddleware({
    models,
    backendPath: "/api",
    adminPath: "/model-site",
    serveFrontendDist: true,
  })
);

app.use(async (ctx) => {
  ctx.status = 404;
  ctx.body = { error: "Not found" };
});

const port = Number(process.env.PORT) || 3456;
app.listen(port, () => {
  console.log(`http://127.0.0.1:${port}/api/schools`);
  console.log(`Admin catalog: GET /api/models`);
});
```

### 1.4.1 JSX equivalent (SQLite + Koa)

The same **School / Teacher / Student** schema as §1.4, expressed with the JSX DSL. Configure tooling with **`jsxImportSource: "searea"`** (see [§2.4](#24-jsx--define-the-same-schema-declaratively)). Run **`.tsx`** entrypoints with **`tsx`** (e.g. `node --import tsx server.mjs` or `npm run example:koa:model`).

**`education-schema.tsx`** — declarative schema:

```tsx
/** @jsxImportSource searea */
import {
  Database,
  Table,
  IntegerField,
  CharField,
  TextField,
  ForeignKey,
} from "searea";

const EducationSchema = () => (
  <Database>
    <Table
      name="schools"
      admin={{ label: "School", display_field: "name", order: 1 }}
    >
      <IntegerField name="id" primaryKey />
      <CharField name="name" maxLength={200} label="Name" />
      <TextField name="address" null label="Address" />
    </Table>

    <Table
      name="teachers"
      admin={{ label: "Teacher", display_field: "name", order: 2 }}
    >
      <IntegerField name="id" primaryKey />
      <CharField name="name" maxLength={128} />
      <ForeignKey name="school" relatedTable="schools" label="School" />
    </Table>

    <Table
      name="students"
      admin={{ label: "Student", display_field: "name", order: 3 }}
    >
      <IntegerField name="id" primaryKey />
      <CharField name="name" maxLength={128} />
      <ForeignKey name="school" relatedTable="schools" />
      <ForeignKey name="teacher" relatedTable="teachers" null />
    </Table>
  </Database>
);

export default EducationSchema;
```

**`server.mjs`** — mount REST via **`schema`** (middleware calls **`compileSchema`** internally):

```js
import Koa from "koa";
import bodyParser from "koa-bodyparser";
import { tsImport } from "tsx/esm/api";
import { Model, createSqlite3Adaptor, createKoaRestMiddleware } from "searea";

const db = createSqlite3Adaptor({ filename: "./education.sqlite3" });
Model.useDB(db);

const { default: EducationSchema } = await tsImport(
  "./education-schema.tsx",
  import.meta.url
);

const restMw = await createKoaRestMiddleware({
  schema: EducationSchema(),
  backendPath: "/api",
  adminPath: "/model-site",
  serveFrontendDist: true,
});

for (const ModelClass of Object.values(restMw.models)) {
  await db.ensureTable(ModelClass);
}

const app = new Koa();
app.use(bodyParser());
app.use(restMw);

app.use(async (ctx) => {
  ctx.status = 404;
  ctx.body = { error: "Not found" };
});

const port = Number(process.env.PORT) || 3456;
app.listen(port, () => {
  console.log(`http://127.0.0.1:${port}/api/schools`);
  console.log(`Admin catalog: GET /api/models`);
});
```

**`ForeignKey`** uses **`relatedTable="earlier_table_name"`** — the referenced **`<Table name="…">`** must appear **above** in the same **`<Database>`**. Full campus JSX with managers and **`on*`** hooks: [`examples/tutorials/campus-shared/model.tsx`](../examples/tutorials/campus-shared/model.tsx); runnable server: [`examples/tutorials/koa-schema-jsx/koa-model-server.mjs`](../examples/tutorials/koa-schema-jsx/koa-model-server.mjs).

### 1.5 Repository reference example

For seed data, extra tables (`districts`, `parents`), and **`events`** hooks, see [`examples/tutorials/koa-rest/koa-rest-server.mjs`](../examples/tutorials/koa-rest/koa-rest-server.mjs) and [`examples/tutorials/campus-shared/lib/campus-demo.mjs`](../examples/tutorials/campus-shared/lib/campus-demo.mjs). Run **`npm run example:koa`** from a clone.

### 1.6 Built-in Admin SPA — test APIs without Postman or curl

The Koa example ([`createKoaRestMiddleware`](../src/server-adapters/koa/koa.js)) can host the **Searea Admin** single-page app under **`/model-site/`** once the frontend bundle exists. That UI includes:

1. **API Explorer** — a **Postman-style** workbench (collections, method/URL bar, Params/Headers/Body tabs, **Send**) wired to your live **`backendPath`**.
2. **Schema diff / migration** — visual **model vs database** comparison and **Execute migration**, backed by **`GET /api/schema-diff`** and **`POST /api/schema-migrate`**.

From the repo root:

```bash
npm run frontend:build:model-site
npm run example:koa
```

Then open **`http://127.0.0.1:3456/model-site/api-explorer`** (API Explorer) and **`http://127.0.0.1:3456/model-site/schema-diff`** (database diff). A full click-by-click testing guide, screenshots, and automation notes live in **[§8](#8-built-in-admin-ui-api-explorer-and-schema-migration)**.

---

## 2. MySQL from scratch, `Model.define`, and JSX schema

### 2.0 ORM API reference

Searea’s ORM is **Django-shaped**: **`ModelClass.objects`** returns lazy **`QuerySet`s**; **`await qs`** materializes rows. Foreign keys on instances are **getters** that return **Promises** (no ORM-side cache). For execution order, SQL push-down rules, and validation on REST writes, see **[§5](#5-core-orm--execution-model-and-api-surface)**.

#### `Model` (class)

| Method / property | Returns | Usage |
|-------------------|---------|--------|
| **`Model.useDB(db)`** | `void` | Register the default DB adapter for all models that do not pass **`db`** to **`define` / `init`**. Call once at startup: **`Model.useDB(createSqlite3Adaptor({ filename }))`**. |
| **`await Model.define({ table, fields, db?, managers?, admin?, events?, ensureTable? })`** | `Promise<typeof ConcreteModel>` | Define a model class without writing **`class X extends Model`**. Sets **`ConcreteModel.table`**, **`.fields`**, **`.objects`**, FK accessors, reverse accessors. Default **`ensureTable: false`**. |
| **`await ModelClass.init({ … })`** | `Promise<typeof ModelClass>` | Same as **`define`**, but on a subclass you declared: **`class Student extends Model {}`** then **`await Student.init({ table: "students", fields })`**. |
| **`await ModelClass.serialize(instance, opts?)`** | `Promise<object>` | Plain JSON dict for one row. **`opts`**: **`{ fkDepth?, expand? }`** or a number (**`fkDepth`** shorthand). Used by REST and **`QuerySet.values()`**. |
| **`ModelClass.table`** | `string` | SQL table name; default REST **`resourceKey`**. |
| **`ModelClass.fields`** | `object` | Field definition map from **`define` / `init`**. |
| **`ModelClass.objects`** | **`Manager`** | Default manager (always present). |
| **`ModelClass[name]`** | **`Manager`** | Extra managers from **`managers: { large_campus: LargeCampusManager }`** (cannot be named **`objects`**). |
| **`ModelClass.admin`** | `object` | Admin metadata (**`label`**, **`display_field`**, **`order`**, …). |
| **`ModelClass.events`** | `object` | REST hooks (**`onGetList`**, **`onGetItem`**, **`onPost`**, **`onPatch`**, **`onDelete`**). |

**`defineModel(table, fields, { managers?, db? })`** ([`src/index.js`](../src/index.js)) is sugar for **`Model.define({ table, fields, managers, db })`**.

#### Model instance

| Member | Type | Usage |
|--------|------|--------|
| **`new ModelClass(attrs)`** | instance | Build an in-memory row. FK values may be **ids** or **related instances**; stored internally as ids. |
| **`instance.id`**, scalar fields | value | Column values from the DB or constructor. |
| **`instance.fkField`** | `Promise<Related \| null>` | FK getter — **`await student.school`** loads the related row by id. Returns **`null`** when FK is unset. |
| **`instance.related_set`** | **`ReverseManager`** | Reverse FK accessor (default name: table **`students`** → **`student_set`**; override with **`relatedName`** on the FK field; **`relatedName: "+"`** disables reverse). |

There is **no** **`instance.save()`** / **`instance.delete()`** — use **`Manager.create`**, **`QuerySet.update`**, or **`QuerySet.delete`**.

#### `Manager` (`ModelClass.objects` and custom managers)

| Method | Returns | Usage |
|--------|---------|--------|
| **`.all()`** | **`QuerySet`** | All rows (lazy). Equivalent to **`.filter({})`**. |
| **`.filter(where)`** | **`QuerySet`** | Rows matching **`where`** (AND semantics when chained on a queryset). |
| **`.values(opts?)`** | **`QuerySet`** | Same as **`.all().values(opts)`** — evaluated result is plain dicts via **`serialize`**. |
| **`await .create(attrs)`** | `Promise<instance>` | Insert one row. Fills missing keys from field **`default`**. FK attrs accept id or instance. |
| **`await .get(where)`** | `Promise<instance>` | Exactly one row, else **`Error: DoesNotExist`** (0 rows) or **`MultipleObjectsReturned`** (2+). |

```js
const school = await School.objects.create({ name: "North High", address: "1 Main St" });
const teachers = await Teacher.objects.filter({ school: school.id }).orderBy("name");
const one = await Student.objects.get({ id: 42 });
const rows = await Student.objects.filter({ age: { $gte: 18 } }).values({ fkDepth: 0 });
```

#### `QuerySet` (lazy, thenable)

Chain **`.filter` / `.exclude` / `.orderBy` / `.limit` / `.offset` / `.values`** without hitting the DB until **`await qs`**, **`await qs.all()`**, **`await qs.first()`**, **`await qs.count()`**, etc.

| Method | Returns | Usage |
|--------|---------|--------|
| **`.filter(extraWhere)`** | **`QuerySet`** | AND-merge **`extraWhere`** into the current filter. |
| **`.exclude(extraWhere)`** | **`QuerySet`** | Exclude rows matching the clause (applied in memory after **`select`**). |
| **`.orderBy('name', '-id')`** | **`QuerySet`** | Sort in memory. Prefix **`-`** = descending. |
| **`.limit(n)`** | **`QuerySet`** | Keep at most **`n`** rows after sort. |
| **`.offset(n)`** | **`QuerySet`** | Skip first **`n`** rows after sort. |
| **`.values(opts?)`** | **`QuerySet`** | Switch output to plain dicts (**`outputMode: 'values'`**). **`opts`**: **`{ fkDepth, expand }`** or fkDepth number. |
| **`await qs`** / **`.then(...)`** | `Promise<instance[]>` | Evaluate to **model instances** (unless **`.values()`** was used). |
| **`await .evaluate()`** | `instance[] \| object[]` | Explicit evaluation (same as **`await qs`**). |
| **`await .all()`** | same as **`evaluate`** | Sugar when you already hold a queryset. |
| **`await .first()`** | `instance \| null` | First matching row, or **`null`**. |
| **`await .count()`** | `number` | Row count for the current filter. Uses **`db.count`** when the queryset has no exclude/order/limit/offset; otherwise counts in memory. |
| **`await .sum(fieldName)`** | `number \| null` | Sum of a **`type: "number"`** field. Pushes to **`db.sum`** when the queryset is filter-only; otherwise sums in memory. |
| **`await .avg(fieldName)`** | `number \| null` | Average of a **`type: "number"`** field (same push-down rules as **`sum`**). |
| **`await .update(attrs)`** | `number` | Bulk update rows matching **`.filter`** only. **Throws** if the queryset used **`exclude`**, **`orderBy`**, **`limit`**, or **`offset`**. Returns affected row count. |
| **`await .delete()`** | `number` | Bulk delete with the same restriction as **`update`**. Returns affected row count. |

```js
const qs = Student.objects.filter({ school: 1 }).exclude({ age: { $lt: 16 } }).orderBy("-age").limit(10);
const page = await qs;
const total = await Student.objects.filter({ school: 1 }).count();
const budget = await School.objects.filter({ id: 1 }).sum("size");
await Student.objects.filter({ school: 1 }).update({ sex: "女" });
await Student.objects.filter({ id: 999 }).delete();
```

#### `ReverseManager` (`await parent.student_set`)

| Method | Returns | Usage |
|--------|---------|--------|
| **`.all()`** | **`QuerySet`** | Children pointing at **`parent.id`**. |
| **`.filter(where)`** | **`QuerySet`** | Scoped filter **and** parent FK. |
| **`.values(opts?)`** | **`QuerySet`** | Plain dicts for children of this parent. |
| **`await .create(attrs)`** | `Promise<child>` | Insert child with **`fkField = parent.id`** merged in. |
| **`await .get(where)`** | `Promise<child>` | One child of this parent; same errors as **`Manager.get`**. |

```js
const school = await School.objects.get({ id: 1 });
const pupils = await school.student_set.filter({ age: { $gte: 18 } });
await school.student_set.create({ name: "Ada", age: 15 });
```

#### Lookup operators (`filter` / `get` / `update` attrs)

Passed to **`normalizeWhereForModel`** ([`src/core/queryset.js`](../src/core/queryset.js)):

| Form | Meaning |
|------|---------|
| **`{ field: value }`** | Equality. |
| **`{ field: null }`** | **`IS NULL`** (column **`null`** or **`undefined`** in row). |
| **`{ field: { $in: [1, 2, 3] } }`** | Value in list. Empty **`$in`** matches nothing. |
| **`{ field: { $gt: n } }`**, **`$gte`**, **`$lt`**, **`$lte`** | Numeric / comparable comparisons (in memory for **`exclude`** / sort paths). |
| **`{ fk: relatedInstance }`** | FK normalized to **`relatedInstance.id`**. |

#### Quick map: read vs write

| Goal | API |
|------|-----|
| List / search | **`await Model.objects.filter(where)`** (+ chain) |
| One row by key | **`await Model.objects.get(where)`** |
| Insert | **`await Model.objects.create(attrs)`** |
| Bulk update | **`await Model.objects.filter(where).update(attrs)`** |
| Bulk delete | **`await Model.objects.filter(where).delete()`** |
| JSON for API | **`await Model.serialize(instance, opts)`** or **`await qs.values(opts)`** |
| Related row | **`await instance.fkField`** |
| Children of parent | **`await parent.child_set.all()`** |

Specification tests: [`test/model.test.js`](../test/model.test.js), [`test/orm-aggregates.test.js`](../test/orm-aggregates.test.js), [`test/example-model-orm.test.mjs`](../test/example-model-orm.test.mjs).

### 2.1 MySQL connection

```js
import { Model, createMysqlAdaptor } from "searea";

const db = createMysqlAdaptor({
  url: process.env.MYSQL_URL ?? "mysql://user:pass@127.0.0.1:3306/student_app",
});
Model.useDB(db);
```

Unless you pass **`ensureDatabase: false`**, the adapter may run **`CREATE DATABASE IF NOT EXISTS`** when the URL names a logical database. Use **`ensureDatabase: false`** if the DB user cannot create databases.

After **`Model.useDB(db)`**, define models the same way as SQLite, then **`await db.ensureTable(EachModel)`** before serving traffic.

### 2.2 `examples/tutorials/campus-shared/model-define.mjs` — programmatic schema (no JSX)

[`examples/tutorials/campus-shared/model-define.mjs`](../examples/tutorials/campus-shared/model-define.mjs) exports **`buildCampusSchemaDefine()`**, which **`await`s** several **`Model.define`** calls and returns **`{ models }`**. Key ideas:

- **Order**: `District` → `School` (FK to `District`) → `Teacher` / `Parent` / `Student` (FKs to `School` / `Teacher`).
- **`admin`**: drives admin UI ordering and labels (`label`, `display_field`, `app`, `order`).
- **`events`**: REST lifecycle hooks (`onPost`, `onGetList`, …) stored on **`ModelClass.events`**; the REST layer reads them automatically (see §4 and §7).

You can copy that file’s pattern for a **student-only** system: either keep a `schools` parent table for the `school` FK, or start with a flat `students` table without FKs, then add relations later and migrate (§3).

### 2.3 `Model.define` — field types and options

Field definitions are validated in [`src/core/validate.js`](../src/core/validate.js). Allowed **`type`** values:

| `type` | SQL-ish role | Notes |
|--------|----------------|-------|
| `number` | Integer / BIGINT | Primary keys use autoincrement DDL per dialect. |
| `char` | `VARCHAR(n)` | **`max_length`** (positive number) is **required**. |
| `text` | `TEXT` | Unbounded text. |
| `date` | `DATE` | |
| `datetime` | `DATETIME` | |
| `fk` | Integer column + ORM relation | **`relatedModel`** must be the target **class**; reverse accessor installed on parent unless `relatedName: "+"`. |

Common **per-field** keys:

| Key | Meaning |
|-----|---------|
| `primaryKey` | Primary key column; affects DDL and REST (skips PK on PATCH body in [`pickWritableAttrs`](../src/server-adapters/core/rest-dispatch.js)). |
| `null` | Nullable column; interacts with validation when writing empty strings. |
| `default` | Default on insert when key omitted (`Manager.create` fills defaults from field defs). |
| `label` | Display name in **`GET /:resource/meta`** and admin UI. For FKs, set **`label` on the field** if you need a friendly name — meta does not pull `admin.label` from the related model automatically. |
| `choices` | `{ value, label }[]` — enforced on writes for `char` / `text` / `number`. |
| `pattern` | Regex string — allowed only on `char` / `text`. |
| `relatedName` | Reverse name on parent model; default derived from child table (e.g. table `students` → `student_set`). |

**Top-level `Model.define` options** ([`src/core/model.js`](../src/core/model.js)):

| Key | Role |
|-----|------|
| `table` | SQL table name; also the default **`resourceKey`** when you pass `models: { [table]: Class }`. |
| `fields` | Field map. |
| `db` | Override global DB for this model. |
| `managers` | Extra **`Manager`** subclasses (cannot be named `objects`). |
| `admin` | Admin metadata object. |
| `events` | REST hooks object (`onGetList`, `onGetItem`, `onPost`, `onPatch`, `onDelete`). |
| `ensureTable` | If `true`, calls `db.ensureTable(this)` at end of `init`. |

### 2.4 JSX — define the same schema declaratively

See [`examples/tutorials/campus-shared/model.tsx`](../examples/tutorials/campus-shared/model.tsx). Configure tooling with:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "searea"
  }
}
```

At runtime:

```js
import { compileSchema } from "searea";
const { models, tables } = await compileSchema(App());
```

- **`models`**: same shape as **`{ [tableName]: ModelClass }`** from manual `Model.define`.
- **`tables`**: AST used by admin / migration tooling.
- **`ForeignKey`** in JSX uses **`relatedTable="earlier_table_name"`** — the referenced `<Table name="…">` must appear **above** in the same `<Database>`.

**`BooleanField`** compiles to a **numeric** column with `0` / `1` defaults ([`src/schema/compile.js`](../src/schema/compile.js)).

Mount REST with either **`models`** or **`schema: <DatabaseRoot />`** (middleware compiles JSX internally). Example: [`examples/tutorials/koa-schema-jsx/koa-model-server.mjs`](../examples/tutorials/koa-schema-jsx/koa-model-server.mjs).

---

## 3. Database tables, schema diff, and migrations

This section is the **database migration** story: how structure is created, how the running DB is compared to models, and how DDL is applied.

### 3.1 Creating tables (bootstrap)

**Programmatic (typical):**

```js
for (const M of Object.values(models)) {
  await db.ensureTable(M);
}
```

**`ensureTable` inside model registration:**

```js
await Model.define({
  table: "books",
  ...,
  ensureTable: true,
});
```

`ensureTable` uses each field’s `type` and options to emit **`CREATE TABLE`** (see dialect-specific builders in [`src/server-adapters/core/schema-diff.js`](../src/server-adapters/core/schema-diff.js) and adapter code). There is **no automatic background sync** on every request — that is intentional so production schema changes stay explicit.

### 3.2 Admin / HTTP: inspecting model vs database

Under your **`backendPath`** (default **`/api`**), the REST core reserves several first-segment paths ([`createRestDispatch`](../src/server-adapters/core/rest-dispatch.js)):

| Method | Path | Handler |
|--------|------|---------|
| GET | `/schema-diff` | **`computeSchemaDiff({ models, db })`** |
| POST | `/schema-migrate` | **`applySchemaMigration({ db, diff, resourceKey })`**, then re-runs diff |

Full URL example: **`GET http://127.0.0.1:3456/api/schema-diff`**.

#### Visual console (Admin SPA)

When the admin bundle is served (see **§1.6** and **§8**), open **`/model-site/schema-diff`**. The page calls the same HTTP endpoints and shows **per-table** diffs, SQL preview, filters (only differences / only missing tables), and **Execute migration** — without hand-assembling JSON in curl for routine additive DDL.

![Searea Admin — Schema diff and migration UI (example: campus demo on port 3456)](./images/schema-diff.png)

For a longer walkthrough (high-risk toggles, `canRunMigration: false`, SQLite rebuilds), see **[§8.3](#83-schema-diff-and-migration-console)**.

The JSON body of **`GET /schema-diff`** has shape **`{ tables: [ ... ] }`**. Each entry includes:

- **`resourceKey`**, **`table`**, **`exists`**
- **`expected`** — columns inferred from **`ModelClass.fields`**
- **`actual`** — columns read from SQLite (`PRAGMA table_info`) or MySQL (`information_schema`)
- **`diff`**: **`missingColumns`**, **`extraColumns`**, **`changedColumns`**, **`warnings`**
- **`serverSql`**: **`migrationSql`** (array of SQL strings), **`canRunMigration`** (boolean)

**`canRunMigration`** can be `false` when the generator refuses unsafe operations (e.g. SQLite needs a table rebuild, or there are **warnings** such as **`ADD COLUMN NOT NULL` without `default`** — see **`diffOneTable`** in [`schema-diff.js`](../src/server-adapters/core/schema-diff.js)).

### 3.3 Applying migrations — **POST `/schema-migrate`**

The server **does not recompute** the diff from models at migrate time. The client must send the **exact snapshot** returned by **`GET /schema-diff`**:

```http
POST /api/schema-migrate
Content-Type: application/json

{
  "diff": { "tables": [ /* same objects as GET /schema-diff */ ] },
  "resourceKey": "students"
}
```

- **`diff`** — **required**; must be `{ tables: [...] }` matching the earlier GET.
- **`resourceKey`** — optional; if set, only that resource’s table entry is migrated.

Implementation ([`applySchemaMigration`](../src/server-adapters/core/schema-diff.js)):

1. For each selected table, take **`serverSql.migrationSql`** (or rebuild via **`buildMigrationSql`**).
2. If **`canRunMigration`** is false, records an error step (`当前迁移无法自动执行…`).
3. Otherwise runs each statement via **`db.exec`** (skips lines that are SQL comments only).

Response ([`rest-dispatch.js`](../src/server-adapters/core/rest-dispatch.js)): **`200`** with **`{ ok: true, result, after }`** if all steps succeed, else **`400`** with **`ok: false`**. **`after`** is a fresh **`computeSchemaDiff`** so you can confirm drift is gone.

### 3.4 What SQL is generated? (dialect behavior)

**MySQL** ([`buildMigrationSql`](../src/server-adapters/core/schema-diff.js)):

- Missing table → **`CREATE TABLE … ENGINE=InnoDB … utf8mb4`**
- Missing column → **`ALTER TABLE … ADD COLUMN …`**
- Changed column → **`ALTER TABLE … MODIFY COLUMN …`**
- Extra column → **`ALTER TABLE … DROP COLUMN …`**

**SQLite**:

- Missing table → **`CREATE TABLE`**
- **Simple case** (only missing columns, no extras/changes/warnings) → **`ALTER TABLE … ADD COLUMN`** per missing field
- **Complex case** (extra columns, changed types/null/defaults, or warnings) → **table rebuild** inside a transaction: `CREATE …__new`, `INSERT … SELECT`, `DROP`, `ALTER RENAME`, `COMMIT`

This matches SQLite’s limited **`ALTER TABLE`** support.

### 3.5 “CRUD on fields” vs “CRUD on rows”

- **Schema / column changes** — use **`schema-diff`** + **`schema-migrate`** (or run DDL yourself). There is no Django-style migration file tree; the **diff payload** is the contract.
- **Row CRUD** — normal REST **`POST /api/{resource}`**, **`PATCH /api/{resource}/:id`**, **`DELETE …`**, or ORM **`create` / `update` / `delete`** (§5). “Updating a field” on a row is **`PATCH`** with JSON body `{ "fieldName": newValue }` (subject to validation).

---

## 4. HTTP / REST relationships between tables

(Your note “表与表之间的 http 时间” is interpreted as **HTTP-level relationships between tables**, not time-based scheduling.)

### 4.1 REST is **per resource**, not nested routers

There is no built-in **`/schools/:id/students`** router. Relations are expressed through:

1. **Foreign key fields** — e.g. `school_id` on `students`; create/update payloads may use **`school: 3`** or nested objects where the REST layer coerces values ([`normalizeWhereForModel`](../src/core/queryset.js), [`pickWritableAttrs`](../src/server-adapters/core/rest-dispatch.js)).
2. **Query `expand`** — **`GET /api/students?expand=school,teacher`** uses **`valuesOptsFromQuery`** → **`Model.serialize`** with **`expand`** so chosen FKs are nested objects instead of only `*_id` scalars.
3. **Reverse accessors (ORM)** — e.g. `await schoolInstance.student_set.all()` traverses FK from parent to children; you can use that inside **`events`** to build custom list/detail payloads.
4. **`events` hooks** — e.g. [`examples/tutorials/campus-shared/model-define.mjs`](../examples/tutorials/campus-shared/model-define.mjs) `Student.events.onPost` creates a related `Parent` row and returns augmented JSON (`peers_in_school`). Any non-`undefined` return replaces the default HTTP body.
5. **`GET /api/:resource/meta`** — **`buildResourceMeta`** exposes field types, FK targets, and reverse relation names for the admin SPA.

### 4.2 Pagination and filters

List endpoints honor **`page`** and **`pageSize`**. Non-reserved query keys that match **field names** become **`filter`** conditions (`listFiltersFromQuery` + **`coerceFilterValue`**).

### 4.3 Built-in paths under `backendPath`

Do **not** use these first path segments as a **`resource`** table key:

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/models` | Admin catalog of registered models |
| GET | `/api-docs` | Lightweight OpenAPI-style JSON |
| GET | `/schema-diff` | Model vs DB column diff (§3) |
| POST | `/schema-migrate` | Apply migration from a prior **`schema-diff`** payload (§3) |

### 4.4 Testing REST from the browser — API Explorer

You do not need a separate **Postman** (or Insomnia) collection to try list/detail/create flows: the bundled **API Explorer** (**`/model-site/api-explorer`**) generates **collections from your registered `models`**, mirrors common patterns (list, get, create, patch, expand, paging), and issues real HTTP requests against **`backendPath`** (default `/api`). It persists light workspace state in the browser (`localStorage` key **`searea.api-explorer.v1`** — see [`docs/superpowers/specs/2026-05-07-api-explorer-postman-ui-design.md`](superpowers/specs/2026-05-07-api-explorer-postman-ui-design.md)).

![Searea Admin — API Explorer (Postman-style workbench)](./images/api-explorer.png)

**Quick test loop**

1. **`GET /api/models`** — confirm the admin catalog matches your `{ resourceKey: ModelClass }` map.
2. Expand a resource in the left rail → choose **List** → **Send** (expect `200` + JSON array or pagination wrapper).
3. **Create** — select **POST** template, set JSON body → **Send** (expect **`201`** when applicable).
4. **Patch** — use a template with `:id` filled from step 2, send partial JSON.

Full UI tour: **[§8.2](#82-api-explorer-postman-style-workbench)**.

### 4.5 CRUD on `{resource}`

Assume **`backendPath`** is `/api` and a model is registered as **`students`**:

| Method | Path | Behavior |
|--------|------|----------|
| GET | `/students` | List; with `page` / `pageSize`, JSON pagination wrapper |
| GET | `/students?expand=school,teacher` | FK expansion per §4.1 |
| GET | `/students/:id` | Retrieve one |
| POST | `/students` | Create; **201** + **`Location`** when applicable |
| PATCH or PUT | `/students/:id` | Partial / full update of **non-PK** writable fields |
| DELETE | `/students/:id` | Default **204**; **200** with body if hook returns a body |

**Lifecycle hooks** on each model ([`KNOWN_REST_EVENT_NAMES`](../src/core/validate.js)): **`onGetList`**, **`onGetItem`**, **`onPost`**, **`onPatch`**, **`onDelete`**. Signature **`({ models, instance })`**. If the handler **`return`s** a value other than **`undefined`**, that value becomes the HTTP JSON body.

---

## 5. Core ORM — execution model and API surface

### 5.1 Class-level vs instances

- **`School`**, **`Student`** — concrete subclasses of **`Model`** with **`School.table`**, **`School.fields`**, **`School.objects`**, etc.
- **`new Student(attrs)`** / rows from the DB — **instances**. Foreign keys on instances: scalar ids live in an internal symbol map; **`instance.school`** is a **getter** returning **`relatedModel.objects.get({ id })`** (a **Promise** of the related row).

### 5.2 Manager and lazy QuerySets

- **`Model.objects`** — default **`Manager`** ([`src/core/manager.js`](../src/core/manager.js)).
- **`Manager.filter(where)`** → new **`QuerySet`** (not executed yet).
- **`QuerySet`** is **thenable**: **`await qs`** runs **`evaluate()`** and returns **model instances** (or plain dicts if **`outputMode === 'values'`**).

### 5.3 Chaining

From [`src/core/queryset.js`](../src/core/queryset.js):

- **`filter(extraWhere)`** — AND-merge with existing WHERE clause.
- **`exclude(extraWhere)`** — row must **fail** all exclude clauses (in-memory filter after `select`).
- **`orderBy('name', '-id')`** — `-` prefix = descending.
- **`limit(n)`**, **`offset(n)`** — applied after sort in memory for the loaded page (not OFFSET in SQL unless adapter adds it — current `select` returns full matching set for small apps; see tests for expected scale).
- **`values(opts)`** — **`await qs.values()`** → **`serialize`** each row; **`opts`** may be **`{ fkDepth, expand }`** or a number (fkDepth shorthand).

### 5.4 Lookups on `filter` / `get`

**`normalizeWhereForModel`** accepts:

- Equality: `{ school: 2 }` or `{ school: schoolInstance }` (FK normalized to id).
- **`$in`**, **`$gte`**, **`$gt`**, **`$lte`**, **`$lt`** on scalar fields ([`rowMatchesWhere`](../src/core/queryset.js)).

### 5.5 Writes

- **`await Model.objects.create(attrs)`** — applies field **`default`** for missing keys, inserts via **`db.insert`**, returns new instance.
- **`await Model.objects.get(where)`** — 0 rows → **`Error: DoesNotExist`**, 2+ rows → **`MultipleObjectsReturned`**.
- **`await qs.update(attrs)`** — **only** when queryset has **no** `exclude`, `orderBy`, `limit`, or `offset` (throws otherwise). Updates all rows matching **`filter`**.
- **`await qs.delete()`** — same restriction; deletes all matching rows.

### 5.6 Serialization

**`await Model.serialize(instance, { fkDepth, expand })`** ([`src/core/model.js`](../src/core/model.js)):

- **`fkDepth`** — how deep to nest FK objects by default.
- **`expand`** — explicit list of FK **names** to expand regardless of depth rules.

REST list/detail uses this through **`valuesOptsFromQuery`** and internal handlers.

### 5.7 Reverse relations

**`ReverseManager`** ([`src/core/manager.js`](../src/core/manager.js)): **`await parent.student_set.filter(...)`**, **`.create({ name })`** auto-wires the FK to **`parent.id`**.

### 5.8 Validation

**`validateWriteAttrs`** / **`validateFilterWhere`** ([`src/core/field-validation.js`](../src/core/field-validation.js)) enforce **`choices`**, **`pattern`**, and type shape on REST writes.

### 5.9 Tests as specification

- [`test/model.test.js`](../test/model.test.js)
- [`test/example-model-orm.test.mjs`](../test/example-model-orm.test.mjs)

---

## 6. SQLite and MySQL adapters

### 6.1 SQLite — `createSqlite3Adaptor({ filename, logSql? })`

- **`filename: ":memory:"`** for ephemeral tests.
- Disk paths: parent directories may be created automatically.
- Dialect **`sqlite`** — affects migration SQL generation.
- **SQL logging** — optional **`logSql`**: **`true`** logs each statement and placeholder array to **`console.error`** as **`[searea sql:sqlite]`**; **`false`** turns logging off (and ignores env); **`( { sql, params, dialect } ) => void`** for a custom sink. If **`logSql`** is omitted, set **`SEAREA_LOG_SQL=1`** or **`true`** to enable the default logger.

### 6.2 MySQL — `createMysqlAdaptor({ url, ensureDatabase?, logSql?, ... })`

- Uses **`mysql2`** promises pool.
- **`ensureDatabase: false`** — skip automatic **`CREATE DATABASE`**.
- Dialect **`mysql`** — **`BIGINT`**, **`MODIFY COLUMN`**, **`DROP COLUMN`**, **`ENGINE=InnoDB`**, **`utf8mb4`**.
- **`logSql`** — same semantics as SQLite (**`[searea sql:mysql]`** prefix when **`true`** / env).

Both adapters must implement the methods used by **`ensureTable`**, **`computeSchemaDiff`**, and CRUD in **`core/`**.

---

## 7. Express, Koa, and Egg

| Framework | Factory | Example file |
|-----------|---------|----------------|
| **Koa** | `createKoaRestMiddleware` | [`examples/tutorials/koa-rest/koa-rest-server.mjs`](../examples/tutorials/koa-rest/koa-rest-server.mjs), [`examples/tutorials/koa-schema-jsx/koa-model-server.mjs`](../examples/tutorials/koa-schema-jsx/koa-model-server.mjs) |
| **Express** | `createExpressRestMiddleware` | [`examples/tutorials/express-rest/express-rest-server.mjs`](../examples/tutorials/express-rest/express-rest-server.mjs) |
| **Egg** | `createEggSeareaRestMiddleware` | [`examples/tutorials/egg-campus/start.mjs`](../examples/tutorials/egg-campus/start.mjs) |

Shared behavior lives in [`src/server-adapters/core/rest-dispatch.js`](../src/server-adapters/core/rest-dispatch.js) (`createRestDispatch`). Typical options:

- **`backendPath`** / legacy **`prefix`** — default **`/api`**
- **`models`** or **`schema`**
- **`adminCatalog`**, **`events`** (override per-resource hooks), **`authorize`**
- **`adminPath`**, **`serveFrontendDist`**, **`frontendPath`**

Reserved **`backendPath`** segments: **`models`**, **`api-docs`**, **`schema-diff`**, **`schema-migrate`**, and **`{resource}/meta`** — do not use these as **`resourceKey`** names.

The same middleware options power the **Admin SPA** (`adminPath`, `serveFrontendDist`, `frontendPath`). Turning **`serveFrontendDist`** on (default when `frontendPath` is set) exposes **API Explorer** and **schema diff** pages documented in **§8**.

---

## 8. Built-in Admin UI: API Explorer and schema migration

Searea ships a **first-party admin frontend** (`src/frontend`) that is optional for production but **high leverage** during development: you get a **Postman-like API Explorer** and a **visual schema diff / migration console** on top of the same public HTTP API (`/schema-diff`, `/schema-migrate`, CRUD). This section is the **product-level** guide; wire protocol details remain in **§3** and **§4**.

### 8.1 Run the campus stack with the SPA

1. **Build** the admin bundle once (or after editing Vue sources):

   ```bash
   npm run frontend:build:model-site
   ```

2. **Start** the demo server (SQLite by default in upstream examples; your clone may point `campus-demo` at MySQL — adjust env accordingly):

   ```bash
   npm run example:koa
   ```

3. **URLs** (default port **`3456`**, [`examples/tutorials/koa-rest/koa-rest-server.mjs`](../examples/tutorials/koa-rest/koa-rest-server.mjs)):

   | What | URL |
      |------|-----|
   | REST prefix | `http://127.0.0.1:3456/api/` |
   | Admin SPA home | `http://127.0.0.1:3456/model-site/` |
   | **API Explorer** | `http://127.0.0.1:3456/model-site/api-explorer` |
   | **Schema diff / migrate** | `http://127.0.0.1:3456/model-site/schema-diff` |
   | Model catalog (JSON) | `GET http://127.0.0.1:3456/api/models` |

If the SPA 404s, confirm **`frontendPath`** resolves to `src/frontend/dist` and rebuild. The dev server logs remind you to run **`VITE_FRONTEND_BASE=/model-site/`**-compatible build ([`package.json`](../package.json) **`frontend:build:model-site`**).

### 8.2 API Explorer (Postman-style workbench)

The **API Explorer** is deliberately **dense**: a **collections rail** (grouped by `resourceKey`), a **request line** (HTTP method + path under `backendPath`), **Send**, and **Params / Headers / Body** tabs — the same muscle memory as **Postman**, without exporting collections to third-party SaaS.

**Why this matters**

- Every route you expose under **`/api/{resource}`** becomes a **repeatable, documented click target** for PMs, QA, and new backend hires.
- **Examples** (e.g. paging, `expand`, invalid page) ship next to raw routes so people learn query conventions from **§4** by doing.

**How to test (recommended flow)**

1. Open **`/model-site/api-explorer`**.
2. Use **Search collections** if you register many models.
3. Expand a resource (e.g. `schools`) → choose **`GET List`** → confirm the path is **`/api/schools`** (or your `backendPath`) → **Send**.
4. Inspect the response in **Body** (formatted JSON), **Headers**, or **Raw**.
5. For **POST** / **PATCH**, switch to **Body**, paste JSON matching **`meta`** / validation rules, then **Send**.
6. Try **`GET /api/models`** from the built-in template to verify **admin metadata** (`label`, `display_field`, FK targets) matches expectations.

Workspace-specific settings (last URL, expanded nodes) may persist via **`localStorage`** — see design note [`2026-05-07-api-explorer-postman-ui-design.md`](superpowers/specs/2026-05-07-api-explorer-postman-ui-design.md).

![API Explorer — default campus demo](./images/api-explorer.png)

### 8.3 Schema diff and migration console

The **Schema diff** page is the **human-facing** counterpart to **`GET /api/schema-diff`** and **`POST /api/schema-migrate`**. It answers three operational questions without reading SQL logs:

1. **Does the physical DB match `Model.define` / JSX?** — missing tables, missing columns, extra columns, changed nullability/defaults/types.
2. **What SQL would fix it?** — per-table **`migrationSql`** preview (dialect-aware: SQLite vs MySQL — see **§3.4**).
3. **Is it safe to run automatically?** — when **`canRunMigration`** is **`false`**, the UI should refuse or warn (e.g. SQLite **table rebuild**, **`ADD COLUMN NOT NULL`** without **`default`**).

**How to test migrations safely**

1. Change a model in code (add a nullable column, or a new table) and restart the Node process so **`Model.fields`** updates.
2. Open **`/model-site/schema-diff`** and click **Refresh** to pull a fresh **`GET /schema-diff`** snapshot.
3. Filter **only differences** or **only uncreated tables** to shrink noise on large schemas.
4. Expand one table — read **warnings** and the SQL list.
5. When satisfied, **Execute migration** — the client POSTs the **exact prior diff payload** to **`/api/schema-migrate`** (see **§3.3**); the server does **not** recompute diff before apply.
6. After success, the UI typically shows a **post-migrate diff** (`after` in the HTTP response) — expect **no drift** for the tables you touched.

**Heads-up**

- This is **not** a Django **`migrations/`** folder history — the **diff JSON** is the contract. Treat exported payloads like **release artifacts** if you need auditability.
- For **CI / pipelines**, call **`GET /schema-diff`** and **`POST /schema-migrate`** with curl or your deploy script (**§8.4**); do not depend on a headless browser.

![Schema diff — campus demo after models align with DB](./images/schema-diff.png)

### 8.4 Headless and CI testing

The Admin SPA is optional in production. For automation:

- Assert **`GET {backendPath}/schema-diff`** returns **`missingColumns`** / **`canRunMigration`** as expected after DDL operations.
- Use **`POST {backendPath}/schema-migrate`** with a saved diff blob in integration tests ([`test/koa-schema-diff.test.js`](../test/koa-schema-diff.test.js) patterns).

---

## 9. About the author

The maintainer of Searea is **open to work**: backend, full-stack, or developer tooling roles. If you are hiring and want someone who ships ORMs, clear HTTP boundaries, and documentation, please reach out through the GitHub profile or résumé linked from this repository.

---

## License

MIT — see [`LICENSE`](../LICENSE).
