/**
 * 校园示例共用：DB、schema、建表、演示种子数据（原 `koa-rest-server.mjs` 内逻辑）。
 *
 * **默认**加载同目录上级的 **`model-define.mjs`**（`Model.define`，无 tsx）。
 * 需要 JSX 时设置环境变量 **`CAMPUS_SCHEMA=jsx`**，改为编译 **`model.tsx`**。
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { tsImport } from "tsx/esm/api";

import { Model, createSqlite3Adaptor, createMysqlAdaptor, compileSchema } from "searea";
import buildCampusSchemaDefine from "../model-define.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** 仓库根目录（`examples/tutorials/campus-shared/lib` → … → 仓库根） */
export const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

/**
 * @param {{ sqliteFilename?: string }} [opts]
 */
export function createCampusDb(opts = {}) {
  const dbKind = String(process.env.DB ?? "sqlite").toLowerCase();
  if (dbKind === "mysql") {
    return createMysqlAdaptor({
      url:
        process.env.MYSQL_URL ??
        "mysql://root:root@127.0.0.1:3307/searea_test",
    });
  }
  const file = opts.sqliteFilename ?? path.join(REPO_ROOT, "b.sqlite3");
  return createSqlite3Adaptor({ filename: file });
}

/** 默认 `model-define.mjs`；`CAMPUS_SCHEMA=jsx` 时加载 `model.tsx` 并 `compileSchema`。 */
export async function loadCampusSchema() {
  const useJsx = String(process.env.CAMPUS_SCHEMA ?? "").toLowerCase() === "jsx";
  if (useJsx) {
    const { default: App } = await tsImport("../model.tsx", import.meta.url);
    return compileSchema(App());
  }
  return buildCampusSchemaDefine();
}

/**
 * 演示种子数据：表结构不一致或重复启动时跳过，不阻断服务。
 * @param {Record<string, typeof import('searea').Model>} models — `schema.models`
 */
export async function seedCampusDemoOrSkip(models) {
  const District = models.districts;
  const School = models.schools;
  const Teacher = models.teachers;
  const Student = models.students;

  const d1 = await District.objects.create({ name: "东城区", code: "DC01" });
  const d2 = await District.objects.create({ name: "河西区", code: "HX02" });

  const s1 = await School.objects.create({
    name: "第一中学",
    address: "东城路 1 号",
    size: 2400,
    district: d1,
  });
  const s2 = await School.objects.create({
    name: "实验初中",
    address: "河西文化街 8 号",
    size: 980,
    district: d2,
  });
  const s3 = await School.objects.create({
    name: "附属小学",
    address: null,
    size: 620,
    district: d1,
  });
  const s4 = await School.objects.create({
    name: "国际学校",
    address: "保税区 A 座",
    size: 1500,
    district: d2,
  });

  const t1 = await Teacher.objects.create({ name: "陈老师", title: "高级教师", school: s1 });
  const t2 = await Teacher.objects.create({ name: "刘老师", title: "一级教师", school: s1 });
  const t3 = await Teacher.objects.create({ name: "赵老师", title: null, school: s2 });

  await Student.objects.create({ name: "张三", age: 15, school: s1, teacher: t1 });
  await Student.objects.create({ name: "李四", age: 16, school: s1, teacher: t1 });
  await Student.objects.create({ name: "王五", age: 14, school: s2, teacher: t3 });
  await Student.objects.create({ name: "赵六", age: 17, school: s2, teacher: t3 });
  await Student.objects.create({ name: "钱七", age: 12, school: s3, teacher: null });
  await Student.objects.create({ name: "孙八", age: 13, school: s3, teacher: null });
  await Student.objects.create({ name: "周九", age: 16, school: s4, teacher: t2 });
  await Student.objects.create({ name: "吴十", age: 15, school: s4, teacher: t2 });
}

const CAMPUS_TABLES = ["districts", "schools", "teachers", "parents", "students"];

export { CAMPUS_TABLES };

export async function initCampusDemo() {
  const db = createCampusDb();
  Model.useDB(db);

  const schema = await loadCampusSchema();
  const { models } = schema;

  for (const key of CAMPUS_TABLES) {
    const M = models[key];
    if (M) await db.ensureTable(M);
  }

  try {
    await seedCampusDemoOrSkip(models);
  } catch (e) {
    const msg = e && e.message ? String(e.message) : String(e);
    console.warn("[campus-demo] 演示数据未写入（已跳过，不影响服务启动）：", msg);
    console.warn(
      "  常见原因：SQLite 里已有旧表结构（缺列）或与模型不一致；也可能重复启动导致唯一约束。"
    );
    console.warn(
      "  请到管理后台「数据库差异」对缺失列执行 Run（ADD COLUMN），必要时删除示例库 b.sqlite3 后重启。"
    );
  }

  return { models: schema.models };
}
