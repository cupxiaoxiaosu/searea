// @ts-nocheck
/** @jsxImportSource searea */

import {
  Database,
  Table,
  CharField,
  TextField,
  IntegerField,
  ForeignKey,
  Manager,
} from "searea";

import { CHINA_PROVINCE_CHOICES } from "./china-provinces.mjs";

/**
 * JSX 模型定义示例（v1）。
 *
 * 纯 JS 等价：`model-define.mjs`。与 REST 一起跑：**`npm run example:app`**（建表 + 种子）或 **`npm run example:koa:model`**（内存 SQLite、空表）；
 * 校园一体化示例（默认 `model-define`，可选 **`CAMPUS_SCHEMA=jsx`**）：**`npm run example:koa`**。
 *
 * ForeignKey 使用 `relatedTable`，值为先定义的 `<Table name="…">`。
 *
 * **`managers`**：与 **`Model.define({ managers })`** 一致，`{ large_campus: LargeCampusManager }` 等；见 **`test/example-model-orm.test.mjs`**。
 *
 * Table 上的 5 个 `on*` 事件回调签名为 `({ models, instance }) => result`：
 * - 默认 CRUD 完成后触发；回调里可以再做额外操作（跨表查询 / 派生字段 / 审计日志…），
 *   把组装好的对象 `return` 出去，HTTP 响应就用这个返回值。
 * - `return undefined`（或不写 return）走默认 body：单条 = `Model.serialize(instance)`，列表 = 默认数组/分页对象。
 *
 * `instance` 含义：
 * - onPost / onGetItem / onPatch / onDelete：单条 Model 实例（== `Model.objects.get(id)`）。
 * - onGetList：默认要返回的 body，数组（无分页）或 `{ items, total, page, pageSize }`（带 `page`/`pageSize`）。
 */

/** 规模 ≥ 1000 的学校（与 `example-model-orm.test.mjs` 的 `large_campus` 对齐） */
class LargeCampusManager extends Manager {
  filter(where = {}) {
    return super.filter({ ...where, size: { $gte: 1000 } });
  }

  all() {
    return super.filter({ size: { $gte: 1000 } });
  }
}

/** 未成年人 age < 18（与 `example-model-orm.test.mjs` 的 `minors` 对齐） */
class MinorStudentManager extends Manager {
  filter(where = {}) {
    return super.filter({ ...where, age: { $lt: 18 } });
  }

  all() {
    return super.filter({ age: { $lt: 18 } });
  }
}

const App = () => (
  <Database>
    <Table
      name="districts"
      admin={{ label: "区县", display_field: "name", app: "campus", order: 1 }}
      onPost={async ({ models: m, instance }) => {
        await m.schools.objects.create({
          name: "default-school",
          district: instance,
        });
      }}
      onDelete={async ({ models: m, instance }) => {
        await m.schools.objects
          .filter({ name: "default-school", district: instance.id })
          .delete();
      }}
    >
      <IntegerField name="id" primaryKey />
      <CharField name="name" maxLength={128} />
      <CharField
        name="code"
        maxLength={32}
        null
        label="所在省/行政区"
        choices={CHINA_PROVINCE_CHOICES}
      />
    </Table>

    <Table
      name="schools"
      admin={{ label: "学校", display_field: "name", app: "campus", order: 2 }}
      managers={{ large_campus: LargeCampusManager }}
    >
      {/* 字段 `label` 会进到 GET /api/:resource/meta 的 fields.*.label，管理后台表格与表单用这个展示名 */}
      <IntegerField name="id" primaryKey label="主键" />
      <CharField name="name" maxLength={128} label="学校名称" />
      <TextField name="address" null label="地址" />
      <IntegerField name="size" label="规模（人数）" />
      <ForeignKey name="district" relatedTable="districts" label="所属区县" />
    </Table>

    <Table
      name="teachers"
      admin={{ label: "教师", display_field: "name", app: "campus", order: 3 }}
      // onGetList={async ({ instance }) => {
      //   return { ...instance, source: 'onGetList' };
      // }}
      onGetItem={async ({ instance }) => {
        return instance
      }}
    >
      <IntegerField name="id" primaryKey />
      <CharField name="name" maxLength={128} />
      <CharField name="title" maxLength={64} null />
      <ForeignKey name="school" relatedTable="schools" />
    </Table>

    <Table
      name="parents"
      admin={{ label: "家长", display_field: "name", app: "campus", order: 5 }}
    >
      <IntegerField name="id" primaryKey />
      <CharField name="name" maxLength={128} />
      <CharField name="phone" maxLength={32} null />
    </Table>

    <Table
      name="students"
      admin={{ label: "学生", display_field: "name", app: "campus", order: 4 }}
      managers={{ minors: MinorStudentManager }}
      onPost={async ({ models, instance }) => {
        const suffix = Math.floor(Math.random() * 100000);
        await models.parents.objects.create({
          name: `Parent-${suffix}`,
          phone: `13${String(suffix).padStart(9, "0")}`,
        });
        const data = await models.students.serialize(instance, { fkDepth: 0 });
        const peers = data.school_id
          ? await models.students.objects
              .filter({ school: data.school_id })
              .values({ fkDepth: 0 })
          : [];
        return { ...data, peers_in_school: peers.length };
      }}
      onGetList={async ({ instance }) => {
        if (Array.isArray(instance)) {
          return { items: instance, total: instance.length, source: 'onGetList' };
        }
        return { ...instance, ages: instance.items.map((it) => it.age) };
      }}
      onGetItem={async ({ models, instance }) => {
        const data = await models.students.serialize(instance, { fkDepth: 1 });
        return { ...data, fetched_at: new Date().toISOString() };
      }}
      onPatch={async ({ models, instance }) => ({
        ...(await models.students.serialize(instance, { fkDepth: 0 })),
        updated_at: new Date().toISOString(),
      })}
      onDelete={async ({ instance }) => ({
        ok: true,
        deleted: { id: instance.id, name: instance.name },
      })}
    > 
      <IntegerField name="id" primaryKey />
      <CharField name="name" maxLength={128} null defaultValue="" />
      <IntegerField name="age" null defaultValue={0} />
      <CharField name="sex" maxLength={8} null defaultValue="男" />
      <ForeignKey name="school" relatedTable="schools" />
      <ForeignKey name="teacher" relatedTable="teachers" null />
    </Table>
  </Database>
);

export default App;
