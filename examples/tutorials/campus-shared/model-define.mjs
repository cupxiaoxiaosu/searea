/**
 * 与 `examples/tutorials/campus-shared/model.tsx` 同构的校园模型，使用 **Model.define**（无 JSX）。
 * **`examples/tutorials/campus-shared/lib/campus-demo.mjs` 默认加载本文件**；要改用 JSX 时设 `CAMPUS_SCHEMA=jsx`。
 *
 * 返回 **`{ models }`**。REST 的 `onPost` / `onGetList` 等挂在各模型 **`events`** 上；
 * `createKoaRestMiddleware` 会从 **`Model.events`** 读取（仍可用 **`options.events`** 按资源覆盖）。
 *
 * `districts` 的 onPost/onDelete：在新建区县后插入一所默认学校，删除区县时删掉关联的该默认学校
 *（修正 JSX 示例里错误的入参/API 写法，语义与注释一致）。
 */
import { Model } from "searea";

import { CHINA_PROVINCE_CHOICES } from "./china-provinces.mjs";

export async function buildCampusSchemaDefine() {
  const District = await Model.define({
    table: "districts",
    admin: { label: "区县", display_field: "name", app: "campus", order: 1 },
    fields: {
      id: { type: "number", primaryKey: true },
      name: { type: "char", max_length: 128 },
      code: {
        type: "char",
        max_length: 32,
        null: true,
        label: "所在省/行政区",
        choices: CHINA_PROVINCE_CHOICES,
      },
    },
    events: {
      onPost: async ({ models: m, instance }) => {
        await m.schools.objects.create({
          name: "default-school",
          district: instance,
        });
      },
      onDelete: async ({ models: m, instance }) => {
        await m.schools.objects
          .filter({ name: "default-school", district: instance.id })
          .delete();
      },
    },
  });

  const School = await Model.define({
    table: "schools",
    admin: { label: "学校", display_field: "name", app: "campus", order: 2 },
    fields: {
      id: { type: "number", primaryKey: true, label: "主键" },
      name: { type: "char", max_length: 128, label: "学校名称" },
      address: { type: "text", null: true, label: "地址" },
      size: { type: "number", label: "规模（人数）" },
      district: { type: "fk", relatedModel: District, label: "所属区县" },
    },
  });

  const Teacher = await Model.define({
    table: "teachers",
    admin: { label: "教师", display_field: "name", app: "campus", order: 3 },
    fields: {
      id: { type: "number", primaryKey: true },
      name: { type: "char", max_length: 128 },
      title: { type: "char", max_length: 64, null: true },
      school: { type: "fk", relatedModel: School },
    },
    events: {
      onGetItem: async ({ instance }) => instance,
    },
  });

  const Parent = await Model.define({
    table: "parents",
    admin: { label: "家长", display_field: "name", app: "campus", order: 5 },
    fields: {
      id: { type: "number", primaryKey: true },
      name: { type: "char", max_length: 128 },
      phone: {
        type: "char",
        max_length: 32,
        null: true,
        pattern: "^1\\d{10}$",
        label: "手机（REST 校验，仅示例）",
      },
    },
  });

  const Hobby = await Model.define({
    table: "hobbies",
    admin: { label: "爱好", display_field: "name", app: "campus", order: 6 },
    fields: {
      id: { type: "number", primaryKey: true },
      name: { type: "char", max_length: 128 },
    },
  });

  const Student = await Model.define({
    table: "students",
    admin: { label: "学生", display_field: "name", app: "campus", order: 4 },
    fields: {
      id: { type: "number", primaryKey: true },
      name: { type: "char", max_length: 128, null: true, default: "" },
      age: { type: "number", null: true, default: 0 },
      sex: {
        type: "char",
        max_length: 8,
        null: true,
        default: "男",
        choices: [
          { value: "男", label: "男" },
          { value: "女", label: "女" },
        ],
      },
      school: { type: "fk", relatedModel: School },
      teacher: { type: "fk", relatedModel: Teacher, null: true, label: '班主任' },
      hobbies: { type: "m2m", relatedModel: Hobby, label: '爱好' },
    },
    events: {
      onPost: async ({ models: m, instance }) => {
        const suffix = Math.floor(Math.random() * 100000);
        await m.parents.objects.create({
          name: `Parent-${suffix}`,
          phone: `13${String(suffix).padStart(9, "0")}`,
        });
        const data = await m.students.serialize(instance, { fkDepth: 0 });
        const peers = data.school_id
          ? await m.students.objects.filter({ school: data.school_id }).values({ fkDepth: 0 })
          : [];
        return { ...data, peers_in_school: peers.length };
      },
      onGetList: async ({ instance }) => {
        if (Array.isArray(instance)) {
          return { items: instance, total: instance.length, source: "onGetList" };
        }
        return { ...instance, ages: instance.items.map((it) => it.age) };
      },
      onGetItem: async ({ models: m, instance }) => {
        const data = await m.students.serialize(instance, { fkDepth: 1 });
        return { ...data, fetched_at: new Date().toISOString() };
      },
      onPatch: async ({ models: m, instance }) => ({
        ...(await m.students.serialize(instance, { fkDepth: 0 })),
        updated_at: new Date().toISOString(),
      }),
      onDelete: async ({ instance }) => ({
        ok: true,
        deleted: { id: instance.id, name: instance.name },
      }),
    },
  });

  const models = {
    districts: District,
    schools: School,
    teachers: Teacher,
    parents: Parent,
    hobbies: Hobby,
    students: Student,
  };

  return { models };
}

export default buildCampusSchemaDefine;
