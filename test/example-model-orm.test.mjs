/**
 * 与 `examples/tutorials/campus-shared/model.tsx` 同构的校园模型；本文件用 **Model.define**，
 * 文末 **campus jsx:** 三则：`tsImport("../examples/tutorials/campus-shared/model.tsx")` + `compileSchema`，覆盖 **`<Table managers>`**（因 tsx / 源码双份 `Manager`，不用 `instanceof Manager`）。
 * 覆盖 Django 风格 ORM，并增加自定义 **Manager**（`large_campus`、`minors`）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { Model, Manager, createSqlite3Adaptor, normalizeExpandList, compileSchema } from "../src/index.js";
import { tsImport } from "tsx/esm/api";
import { CHINA_PROVINCE_CHOICES } from "../examples/tutorials/campus-shared/china-provinces.mjs";

let dbCounter = 0;

/** 规模 ≥ 1000 的学校（与 `model.test.js` 的 BigSchool 思路一致）。 */
class LargeCampusManager extends Manager {
  filter(where = {}) {
    return super.filter({ ...where, size: { $gte: 1000 } });
  }

  all() {
    return super.filter({ size: { $gte: 1000 } });
  }
}

/** 未成年人（age < 18），与默认 `objects` 并存。 */
class MinorStudentManager extends Manager {
  filter(where = {}) {
    return super.filter({ ...where, age: { $lt: 18 } });
  }

  all() {
    return super.filter({ age: { $lt: 18 } });
  }
}

const CAMPUS_KEYS = ["districts", "schools", "teachers", "parents", "students"];

/**
 * 表、字段与 `examples/tutorials/campus-shared/model.tsx` 对齐（char 长度、text address、默认值等）。
 * @returns {Promise<{ districts: *, schools: *, teachers: *, parents: *, students: * }>}
 */
async function defineCampusModels() {
  const District = await Model.define({
    table: "districts",
    fields: {
      id: { type: "number", primaryKey: true },
      name: { type: "char", max_length: 128 },
      code: {
        type: "char",
        max_length: 32,
        null: true,
        choices: CHINA_PROVINCE_CHOICES,
      },
    },
  });

  const School = await Model.define({
    table: "schools",
    fields: {
      id: { type: "number", primaryKey: true },
      name: { type: "char", max_length: 128 },
      address: { type: "text", null: true },
      size: { type: "number" },
      district: { type: "fk", relatedModel: District },
    },
    managers: {
      large_campus: LargeCampusManager,
    },
  });

  const Teacher = await Model.define({
    table: "teachers",
    fields: {
      id: { type: "number", primaryKey: true },
      name: { type: "char", max_length: 128 },
      title: { type: "char", max_length: 64, null: true },
      school: { type: "fk", relatedModel: School },
    },
  });

  const Parent = await Model.define({
    table: "parents",
    fields: {
      id: { type: "number", primaryKey: true },
      name: { type: "char", max_length: 128 },
      phone: { type: "char", max_length: 32, null: true },
    },
  });

  const Student = await Model.define({
    table: "students",
    fields: {
      id: { type: "number", primaryKey: true },
      name: { type: "char", max_length: 128, null: true, default: "" },
      age: { type: "number", null: true, default: 0 },
      sex: { type: "char", max_length: 8, null: true, default: "男" },
      school: { type: "fk", relatedModel: School },
      teacher: { type: "fk", relatedModel: Teacher, null: true },
    },
    managers: {
      minors: MinorStudentManager,
    },
  });

  return {
    districts: District,
    schools: School,
    teachers: Teacher,
    parents: Parent,
    students: Student,
  };
}

/** `examples/tutorials/campus-shared/model.tsx` → `compileSchema(<Table managers>)`；表结构与 `defineCampusModels` 对齐。 */
async function withCampusJsxDb(fn) {
  const filename = path.join(
    process.cwd(),
    "test",
    `tmp-campus-jsx-${process.pid}-${++dbCounter}.sqlite3`
  );
  await fs.rm(filename, { force: true });

  const db = createSqlite3Adaptor({ filename });
  Model.useDB(db);
  const mod = await tsImport("../examples/tutorials/campus-shared/model.tsx", import.meta.url);
  const { models } = await compileSchema(mod.default());

  for (const key of CAMPUS_KEYS) {
    await db.ensureTable(models[key]);
  }

  try {
    return await fn(db, models);
  } finally {
    Model.useDB(null);
    await db.close();
    await fs.rm(filename, { force: true });
  }
}

async function withCampusDb(fn) {
  const filename = path.join(
    process.cwd(),
    "test",
    `tmp-campus-orm-${process.pid}-${++dbCounter}.sqlite3`
  );
  await fs.rm(filename, { force: true });

  const db = createSqlite3Adaptor({ filename });
  Model.useDB(db);
  const models = await defineCampusModels();

  for (const key of CAMPUS_KEYS) {
    await db.ensureTable(models[key]);
  }

  try {
    return await fn(db, models);
  } finally {
    Model.useDB(null);
    await db.close();
    await fs.rm(filename, { force: true });
  }
}

/** 与 `examples/tutorials/campus-shared/model.tsx` 场景一致的种子数据。 */
async function seedCampus(models) {
  const { districts: District, schools: School, teachers: Teacher, parents: Parent, students: Student } =
    models;

  const north = await District.objects.create({ name: "North", code: "23" });
  const south = await District.objects.create({ name: "South", code: null });

  const school1 = await School.objects.create({
    name: "学校1",
    address: "地址1",
    size: 2000,
    district: north,
  });
  const school2 = await School.objects.create({
    name: "学校2",
    address: null,
    size: 500,
    district: south.id,
  });
  const school3 = await School.objects.create({
    name: "学校3",
    address: "地址3",
    size: 1500,
    district: north,
  });

  const teacher1 = await Teacher.objects.create({ name: "老师1", title: "一级", school: school1 });
  const teacher2 = await Teacher.objects.create({ name: "老师2", title: null, school: school3.id });

  await Parent.objects.create({ name: "家长甲", phone: "13900000001" });
  await Parent.objects.create({ name: "家长乙", phone: null });

  const student1 = await Student.objects.create({
    name: "学生1",
    age: 18,
    school: school1,
    teacher: teacher1,
  });
  const student2 = await Student.objects.create({
    name: "学生2",
    age: 17,
    school: school2.id,
    teacher: null,
  });
  const student3 = await Student.objects.create({
    name: "学生3",
    age: 20,
    school: school1,
    teacher: teacher1,
  });
  const student4 = await Student.objects.create({
    name: "学生4",
    age: 16,
    school: school3,
    teacher: teacher2,
  });

  return {
    north,
    south,
    school1,
    school2,
    school3,
    teacher1,
    teacher2,
    student1,
    student2,
    student3,
    student4,
  };
}

test("campus define: create requires table; ensureTable 后可写", async () => {
  const filename = path.join(
    process.cwd(),
    "test",
    `tmp-campus-orm-${process.pid}-${++dbCounter}.sqlite3`
  );
  await fs.rm(filename, { force: true });
  const db = createSqlite3Adaptor({ filename });
  Model.useDB(db);
  try {
    const models = await defineCampusModels();
    await assert.rejects(
      () => models.schools.objects.create({ name: "x", district: 1, size: 1 }),
      /no such table: schools/
    );
    await db.ensureTable(models.districts);
    await db.ensureTable(models.schools);
    const d = await models.districts.objects.create({ name: "D", code: "44" });
    const row = await models.schools.objects.create({
      name: "已建表",
      size: 100,
      district: d,
    });
    assert.equal(row.name, "已建表");
  } finally {
    Model.useDB(null);
    await db.close();
    await fs.rm(filename, { force: true });
  }
});

test("campus define: managers large_campus / minors 独立于 objects", async () => {
  await withCampusDb(async (_db, models) => {
    const { schools: School, students: Student } = models;

    assert.equal(School.objects instanceof Manager, true);
    assert.equal(School.large_campus instanceof LargeCampusManager, true);
    assert.equal(Student.objects instanceof Manager, true);
    assert.equal(Student.minors instanceof MinorStudentManager, true);
    assert.notStrictEqual(School.objects, School.large_campus);
    assert.notStrictEqual(Student.objects, Student.minors);
  });
});

test("campus define: Manager large_campus filters size ≥ 1000; 可与 filter 链式", async () => {
  await withCampusDb(async (_db, models) => {
    const rows = await seedCampus(models);
    const { schools: School } = models;

    assert.deepEqual(
      (await School.large_campus.all()).map((s) => s.name).sort(),
      ["学校1", "学校3"]
    );
    assert.deepEqual(
      (await School.large_campus.filter({ district: rows.north.id })).map((s) => s.name).sort(),
      ["学校1", "学校3"]
    );
    assert.deepEqual((await School.large_campus.filter({ district: rows.south.id })).map((s) => s.name), []);
    assert.equal((await School.objects.all()).length, 3);
  });
});

test("campus define: Manager minors（age < 18）与按学校筛选", async () => {
  await withCampusDb(async (_db, models) => {
    const rows = await seedCampus(models);
    const { students: Student } = models;

    assert.deepEqual(
      (await Student.minors.all()).map((s) => s.name).sort(),
      ["学生2", "学生4"]
    );
    assert.deepEqual(
      (await Student.minors.filter({ school: rows.school2 })).map((s) => s.name),
      ["学生2"]
    );
    assert.equal((await Student.minors.filter({ school: rows.school1 })).length, 0);
    assert.deepEqual(
      (await Student.minors.filter({ age: { $gte: 16 } })).map((s) => s.name).sort(),
      ["学生2", "学生4"]
    );
  });
});

test("campus jsx (<Table managers>): large_campus / minors 独立于 objects", async () => {
  await withCampusJsxDb(async (_db, models) => {
    const { schools: School, students: Student } = models;

    assert.equal(typeof School.objects?.all, "function");
    assert.equal(typeof School.large_campus?.all, "function");
    assert.equal(typeof Student.objects?.all, "function");
    assert.equal(typeof Student.minors?.all, "function");
    assert.notStrictEqual(School.objects, School.large_campus);
    assert.notStrictEqual(Student.objects, Student.minors);
    assert.equal(School.large_campus.constructor.name, "LargeCampusManager");
    assert.equal(Student.minors.constructor.name, "MinorStudentManager");
  });
});

test("campus jsx: Manager large_campus 行为与 define 一致", async () => {
  await withCampusJsxDb(async (_db, models) => {
    const rows = await seedCampus(models);
    const { schools: School } = models;

    assert.deepEqual(
      (await School.large_campus.all()).map((s) => s.name).sort(),
      ["学校1", "学校3"]
    );
    assert.deepEqual(
      (await School.large_campus.filter({ district: rows.north.id })).map((s) => s.name).sort(),
      ["学校1", "学校3"]
    );
    assert.deepEqual((await School.large_campus.filter({ district: rows.south.id })).map((s) => s.name), []);
    assert.equal((await School.objects.all()).length, 3);
  });
});

test("campus jsx: Manager minors 行为与 define 一致", async () => {
  await withCampusJsxDb(async (_db, models) => {
    const rows = await seedCampus(models);
    const { students: Student } = models;

    assert.deepEqual(
      (await Student.minors.all()).map((s) => s.name).sort(),
      ["学生2", "学生4"]
    );
    assert.deepEqual(
      (await Student.minors.filter({ school: rows.school2 })).map((s) => s.name),
      ["学生2"]
    );
    assert.equal((await Student.minors.filter({ school: rows.school1 })).length, 0);
    assert.deepEqual(
      (await Student.minors.filter({ age: { $gte: 16 } })).map((s) => s.name).sort(),
      ["学生2", "学生4"]
    );
  });
});

test("campus define: objects.create / all / get / filter", async () => {
  await withCampusDb(async (_db, models) => {
    const rows = await seedCampus(models);
    const { schools: School, students: Student } = models;

    const schools = await School.objects.all();
    assert.deepEqual(
      schools.map((s) => s.name).sort(),
      ["学校1", "学校2", "学校3"]
    );

    const s1 = await Student.objects.get({ id: rows.student1.id });
    assert.equal(s1.name, "学生1");
    assert.equal((await s1.school).name, "学校1");

    const adults = await Student.objects.filter({ age: { $gte: 18 } });
    assert.deepEqual(
      adults.map((s) => s.name).sort(),
      ["学生1", "学生3"]
    );
  });
});

test("campus define: QuerySet lazy, chainable, await, first()", async () => {
  await withCampusDb(async (_db, models) => {
    await seedCampus(models);
    const { students: Student } = models;

    const qs = Student.objects.filter({ age: { $gte: 16 } }).filter({ school: 1 });
    assert.equal(typeof qs.then, "function");

    const students = await qs;
    assert.deepEqual(
      students.map((s) => s.name).sort(),
      ["学生1", "学生3"]
    );

    const first = await Student.objects.filter({ age: { $gte: 18 } }).first();
    assert.equal(first.name, "学生1");
  });
});

test("campus define: where $in / $gt / $gte / $lt / $lte", async () => {
  await withCampusDb(async (_db, models) => {
    await seedCampus(models);
    const { students: Student } = models;

    assert.deepEqual(
      (await Student.objects.filter({ id: { $in: [1, 3] } })).map((s) => s.name).sort(),
      ["学生1", "学生3"]
    );
    assert.equal((await Student.objects.filter({ id: { $in: [] } })).length, 0);
    assert.deepEqual(
      (await Student.objects.filter({ age: { $gt: 18 } })).map((s) => s.name),
      ["学生3"]
    );
    assert.deepEqual(
      (await Student.objects.filter({ age: { $gte: 18 } })).map((s) => s.name).sort(),
      ["学生1", "学生3"]
    );
    assert.deepEqual(
      (await Student.objects.filter({ age: { $lt: 17 } })).map((s) => s.name),
      ["学生4"]
    );
    assert.deepEqual(
      (await Student.objects.filter({ age: { $lte: 17 } })).map((s) => s.name).sort(),
      ["学生2", "学生4"]
    );
  });
});

test('campus define: defaults (sex 男, name "", district code null)', async () => {
  await withCampusDb(async (_db, models) => {
    const rows = await seedCampus(models);
    const { districts: District, schools: School, students: Student } = models;

    assert.equal(rows.south.code, null);
    assert.equal(rows.school2.address, null);

    const defaulted = await Student.objects.create({ school: rows.school1 });
    assert.equal(defaulted.name, "");
    assert.equal(defaulted.age, 0);
    assert.equal(defaulted.sex, "男");

    const districtObj = await District.objects.get({ id: rows.south.id });
    const districtValue = await District.serialize(districtObj);
    assert.equal(districtValue.code, null);

    const plainSchool = await School.serialize(rows.school2);
    assert.equal(plainSchool.address, null);
  });
});

test("campus define: FK instance or id; serialize fkDepth 0; teacher null", async () => {
  await withCampusDb(async (_db, models) => {
    const rows = await seedCampus(models);
    const { students: Student } = models;

    assert.equal((await rows.student1.school).id, rows.school1.id);
    assert.equal((await rows.student2.school).id, rows.school2.id);
    assert.equal(await rows.student2.teacher, null);

    const flat = await Student.serialize(rows.student2, { fkDepth: 0 });
    assert.equal(flat.school_id, rows.school2.id);
    assert.equal(flat.teacher_id, null);
  });
});

test("campus define: serialize expand / fkDepth; normalizeExpandList", async () => {
  await withCampusDb(async (_db, models) => {
    const rows = await seedCampus(models);
    const { students: Student } = models;

    assert.deepEqual(normalizeExpandList([" school,teacher ", "district"]), [
      "school",
      "teacher",
      "district",
    ]);

    const depth1 = await Student.serialize(rows.student1);
    assert.equal(depth1.school.name, "学校1");
    assert.equal(depth1.school.district_id, rows.north.id);

    const depth2 = await Student.serialize(rows.student1, { fkDepth: 2 });
    assert.equal(depth2.school.district.name, "North");

    const expanded = await Student.serialize(rows.student1, { expand: "school,district" });
    assert.equal(expanded.school.district.name, "North");
    assert.equal(expanded.teacher_id, rows.teacher1.id);

    const rowValues = await Student.objects.values({ expand: ["school", "district"] });
    assert.equal(rowValues.length, 4);
    assert.equal(rowValues[0].school.district.name, "North");
  });
});

test("campus define: reverse school.student_set", async () => {
  await withCampusDb(async (_db, models) => {
    const rows = await seedCampus(models);

    const school1Students = await rows.school1.student_set.all();
    assert.deepEqual(
      school1Students.map((s) => s.name).sort(),
      ["学生1", "学生3"]
    );

    const adults = await rows.school1.student_set.filter({ age: { $gte: 20 } });
    assert.deepEqual(adults.map((s) => s.name), ["学生3"]);

    const student = await rows.school1.student_set.get({ name: "学生1" });
    assert.equal(student.id, rows.student1.id);

    const created = await rows.school1.student_set.create({ name: "学生5", age: 15 });
    console.log('created', created);
    assert.equal((await created.school).id, rows.school1.id);

    const values = await rows.school1.student_set.values({ fkDepth: 0 });
    assert.ok(values.some((v) => v.name === "学生5" && v.school_id === rows.school1.id));
  });
});

test("campus define: reverse district.school_set & school.teacher_set", async () => {
  await withCampusDb(async (_db, models) => {
    const rows = await seedCampus(models);

    const northSchools = await rows.north.school_set.all();
    assert.equal(northSchools.length, 2);
    assert.ok(northSchools.some((s) => s.name === "学校1"));

    const tset = await rows.school1.teacher_set.all();
    assert.deepEqual(
      tset.map((t) => t.name).sort(),
      ["老师1"]
    );
  });
});

test("campus define: filter by related instance; filter({ teacher: null })", async () => {
  await withCampusDb(async (_db, models) => {
    const rows = await seedCampus(models);
    const { students: Student } = models;

    const bySchool = await Student.objects.filter({ school: rows.school1 });
    assert.deepEqual(
      bySchool.map((s) => s.name).sort(),
      ["学生1", "学生3"]
    );

    const noTeacher = await Student.objects.filter({ teacher: null });
    assert.deepEqual(noTeacher.map((s) => s.name), ["学生2"]);
  });
});

test("campus define: get DoesNotExist; MultipleObjectsReturned", async () => {
  await withCampusDb(async (_db, models) => {
    const rows = await seedCampus(models);
    const { students: Student } = models;

    await assert.rejects(() => Student.objects.get({ id: 999 }), /DoesNotExist/);
    await assert.rejects(() => Student.objects.get({ school: rows.school1.id }), /MultipleObjectsReturned/);
  });
});

test("campus define: count / exclude / orderBy / update / delete", async () => {
  await withCampusDb(async (_db, models) => {
    await seedCampus(models);
    const { students: Student } = models;

    const qs = Student.objects.filter({ age: { $gte: 16 } });
    assert.equal(await qs.count(), 4);
    assert.deepEqual(
      (await qs.exclude({ age: { $lt: 18 } })).map((s) => s.name).sort(),
      ["学生1", "学生3"]
    );
    assert.deepEqual(
      (await qs.orderBy("-age")).map((s) => s.name),
      ["学生3", "学生1", "学生2", "学生4"]
    );
    assert.equal(await qs.update({ sex: "女" }), 4);
    assert.equal(await qs.delete(), 4);
  });
});

test("campus define: limit / offset", async () => {
  await withCampusDb(async (_db, models) => {
    await seedCampus(models);
    const { students: Student } = models;

    const page = await Student.objects.filter({ age: { $gte: 14 } }).orderBy("age").offset(1).limit(2);
    const names = page.map((s) => s.name);
    assert.equal(names.length, 2);
    assert.deepEqual(names, ["学生2", "学生1"]);
  });
});

test("campus define: values() + parents.objects", async () => {
  await withCampusDb(async (_db, models) => {
    await seedCampus(models);
    const { parents: Parent } = models;

    const list = await Parent.objects.values({ fkDepth: 0 });
    assert.equal(list.length, 2);
    assert.ok(list.some((p) => p.name === "家长甲" && p.phone === "13900000001"));
    assert.ok(list.some((p) => p.name === "家长乙" && p.phone === null));
  });
});

test("campus define: QuerySet.update/delete 需纯 filter", async () => {
  await withCampusDb(async (_db, models) => {
    await seedCampus(models);
    const { students: Student } = models;
    const qs = Student.objects.filter({ age: { $gte: 16 } });

    await assert.rejects(
      () => qs.orderBy("-age").update({ sex: "X" }),
      /orderBy\/limit\/offset are not allowed/
    );
    await assert.rejects(
      () => qs.orderBy("-age").delete(),
      /orderBy\/limit\/offset are not allowed/
    );
  });
});
