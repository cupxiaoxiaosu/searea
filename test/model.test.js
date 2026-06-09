import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { Model, Manager, createSqlite3Adaptor, normalizeExpandList } from "../src/index.js";

let dbCounter = 0;

class BigSchoolManager extends Manager {
  filter(where = {}) {
    return super.filter({ ...where, size: { $gte: 1000 } });
  }

  all() {
    return super.filter({ size: { $gte: 1000 } });
  }
}

async function withDb(fn) {
  const filename = path.join(
    process.cwd(),
    "test",
    `tmp-model-${process.pid}-${++dbCounter}.sqlite3`
  );
  await fs.rm(filename, { force: true });

  const db = createSqlite3Adaptor({ filename });
  Model.useDB(db);

  try {
    return await fn(db);
  } finally {
    Model.useDB(null);
    await db.close();
    await fs.rm(filename, { force: true });
  }
}

async function defineSchoolModels(db) {
  const District = await Model.define({
    table: "districts",
    fields: {
      id: { type: "number", primaryKey: true },
      name: { type: "char", max_length: 255 },
      code: { type: "char", max_length: 255, null: true, default: "UNKNOWN" },
    },
  });

  const School = await Model.define({
    table: "schools",
    fields: {
      id: { type: "number", primaryKey: true },
      name: { type: "char", max_length: 255 },
      address: { type: "char", max_length: 255, null: true },
      size: { type: "number", default: 0 },
      district: { type: "fk", relatedModel: District, null: true },
    },
    managers: {
      big_school: BigSchoolManager,
    },
  });

  const Teacher = await Model.define({
    table: "teachers",
    fields: {
      id: { type: "number", primaryKey: true },
      name: { type: "char", max_length: 255 },
      school: { type: "fk", relatedModel: School, relatedName: "teachers" },
    },
  });

  const Student = await Model.define({
    table: "students",
    fields: {
      id: { type: "number", primaryKey: true },
      name: { type: "char", max_length: 255, default: "" },
      age: { type: "number", default: 0 },
      sex: { type: "char", max_length: 255, null: true, default: "M" },
      school: { type: "fk", relatedModel: School },
      teacher: { type: "fk", relatedModel: Teacher, null: true },
    },
  });

  for (const model of [District, School, Teacher, Student]) {
    await db.ensureTable(model);
  }

  return { District, School, Teacher, Student };
}

async function seedSchoolData(models) {
  const { District, School, Teacher, Student } = models;

  const north = await District.objects.create({ name: "North", code: "N" });
  const south = await District.objects.create({ name: "South" });

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

  const teacher1 = await Teacher.objects.create({ name: "老师1", school: school1 });
  const teacher2 = await Teacher.objects.create({ name: "老师2", school: school3.id });

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

test("Model.define uses the global default db and does not create tables implicitly", async () => {
  await withDb(async (db) => {
    const School = await Model.define({
      table: "schools",
      fields: {
        id: { type: "number", primaryKey: true },
        name: { type: "char", max_length: 255 },
      },
    });

    assert.equal(School.db, db);
    await assert.rejects(
      () => School.objects.create({ name: "未建表" }),
      /no such table: schools/
    );

    await db.ensureTable(School);
    const school = await School.objects.create({ name: "已建表" });
    assert.equal(school.name, "已建表");
  });
});

test("Model init validates db, table, and manager configuration", async () => {
  Model.useDB(null);
  await assert.rejects(
    () =>
      Model.define({
        table: "schools",
        fields: { id: { type: "number", primaryKey: true } },
      }),
    /No db configured/
  );

  await withDb(async () => {
    await assert.rejects(
      () => Model.define({ fields: { id: { type: "number", primaryKey: true } } }),
      /No table configured/
    );
    await assert.rejects(
      () =>
        Model.define({
          table: "schools",
          fields: { id: { type: "number", primaryKey: true } },
          managers: { objects: BigSchoolManager },
        }),
      /reserved/
    );
    await assert.rejects(
      () =>
        Model.define({
          table: "schools",
          fields: { id: { type: "number", primaryKey: true } },
          managers: { table: BigSchoolManager },
        }),
      /conflicts/
    );
    await assert.rejects(
      () =>
        Model.define({
          table: "schools",
          fields: { id: { type: "number", primaryKey: true } },
          managers: { active: {} },
        }),
      /must be a class constructor/
    );
  });
});

test('Model init rejects legacy type "string" fields', async () => {
  await withDb(async () => {
    await assert.rejects(
      () =>
        Model.define({
          table: "schools",
          fields: {
            id: { type: "number", primaryKey: true },
            name: { type: `str${"ing"}` },
          },
        }),
      /invalid type "string"/
    );
  });
});

test("objects.create/get/all/filter cover the common Django-ish happy path", async () => {
  await withDb(async (db) => {
    const models = await defineSchoolModels(db);
    const rows = await seedSchoolData(models);
    const { School, Student } = models;

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

test("QuerySet remains lazy, chainable, and evaluates through await", async () => {
  await withDb(async (db) => {
    const models = await defineSchoolModels(db);
    await seedSchoolData(models);
    const { Student } = models;

    const queryset = Student.objects.filter({ age: { $gte: 16 } }).filter({ school: 1 });
    assert.equal(typeof queryset.then, "function");
    assert.equal(typeof queryset.values, "function");

    const students = await queryset;
    assert.deepEqual(
      students.map((s) => s.name).sort(),
      ["学生1", "学生3"]
    );

    const first = await Student.objects.filter({ age: { $gte: 18 } }).first();
    assert.equal(first.name, "学生1");
  });
});

test("where operators support in, empty in, gt, gte, lt, and lte", async () => {
  await withDb(async (db) => {
    const models = await defineSchoolModels(db);
    await seedSchoolData(models);
    const { Student } = models;

    assert.deepEqual(
      (await Student.objects.filter({ id: { $in: [1, 3] } }))
        .map((s) => s.name)
        .sort(),
      ["学生1", "学生3"]
    );
    assert.equal((await Student.objects.filter({ id: { $in: [] } })).length, 0);
    assert.deepEqual((await Student.objects.filter({ age: { $gt: 18 } })).map((s) => s.name), [
      "学生3",
    ]);
    assert.deepEqual(
      (await Student.objects.filter({ age: { $gte: 18 } }))
        .map((s) => s.name)
        .sort(),
      ["学生1", "学生3"]
    );
    assert.deepEqual((await Student.objects.filter({ age: { $lt: 17 } })).map((s) => s.name), [
      "学生4",
    ]);
    assert.deepEqual(
      (await Student.objects.filter({ age: { $lte: 17 } }))
        .map((s) => s.name)
        .sort(),
      ["学生2", "学生4"]
    );
  });
});

test("SQLite defaults and nullable fields are visible on model instances and values()", async () => {
  await withDb(async (db) => {
    const models = await defineSchoolModels(db);
    const rows = await seedSchoolData(models);
    const { District, Student } = models;

    assert.equal(rows.south.code, "UNKNOWN");
    assert.equal(rows.school2.address, null);

    const defaulted = await Student.objects.create({ school: rows.school1 });
    assert.equal(defaulted.name, "");
    assert.equal(defaulted.age, 0);
    assert.equal(defaulted.sex, "M");

    const districtObj = await District.objects.get({ id: rows.south.id });
    const districtValue = await District.serialize(districtObj);
    assert.equal(districtValue.code, "UNKNOWN");
  });
});

test("foreign keys accept model instances or scalar ids and serialize null safely", async () => {
  await withDb(async (db) => {
    const models = await defineSchoolModels(db);
    const rows = await seedSchoolData(models);
    const { Student } = models;

    assert.equal((await rows.student1.school).id, rows.school1.id);
    assert.equal((await rows.student2.school).id, rows.school2.id);
    assert.equal(await rows.student2.teacher, null);

    const flat = await Student.serialize(rows.student2, { fkDepth: 0 });
    assert.equal(flat.school_id, rows.school2.id);
    assert.equal(flat.teacher_id, null);
  });
});

test("m2m fields auto-create a through table and expose a relation manager", async () => {
  await withDb(async (db) => {
    const Hobby = await Model.define({
      table: "hobbies",
      fields: {
        id: { type: "number", primaryKey: true },
        name: { type: "char", max_length: 255 },
      },
    });
    const Student = await Model.define({
      table: "students",
      fields: {
        id: { type: "number", primaryKey: true },
        name: { type: "char", max_length: 255 },
        hobbies: { type: "m2m", relatedModel: Hobby },
      },
    });

    await db.ensureTable(Hobby);
    await db.ensureTable(Student);

    const reading = await Hobby.objects.create({ name: "Reading" });
    const chess = await Hobby.objects.create({ name: "Chess" });
    const student = await Student.objects.create({ name: "Alice" });

    await student.hobbies.add(reading, chess.id);
    assert.deepEqual(
      (await student.hobbies.all()).map((h) => h.name).sort(),
      ["Chess", "Reading"]
    );

    const flat = await Student.serialize(student, { fkDepth: 0 });
    assert.deepEqual(flat.hobbies_ids.sort((a, b) => a - b), [reading.id, chess.id]);

    const expanded = await Student.serialize(student, { expand: "hobbies" });
    assert.deepEqual(
      expanded.hobbies.map((h) => h.name).sort(),
      ["Chess", "Reading"]
    );

    await student.hobbies.remove(reading);
    assert.deepEqual((await student.hobbies.all()).map((h) => h.name), ["Chess"]);

    await student.hobbies.set([reading]);
    assert.deepEqual((await student.hobbies.all()).map((h) => h.name), ["Reading"]);

    await student.hobbies.clear();
    assert.equal((await student.hobbies.all()).length, 0);
  });
});

test("values() expands FK depth and supports selective expand as string or array", async () => {
  await withDb(async (db) => {
    const models = await defineSchoolModels(db);
    const rows = await seedSchoolData(models);
    const { Student } = models;

    assert.deepEqual(normalizeExpandList([" school,teacher ", "district"]), [
      "school",
      "teacher",
      "district",
    ]);

    const defaultDepth = await Student.serialize(rows.student1);
    assert.equal(defaultDepth.school.name, "学校1");
    assert.equal(defaultDepth.school.district_id, rows.north.id);

    const depthTwo = await Student.serialize(rows.student1, { fkDepth: 2 });
    assert.equal(depthTwo.school.district.name, "North");

    const expanded = await Student.serialize(rows.student1, { expand: "school,district" });
    assert.equal(expanded.school.district.name, "North");
    assert.equal(expanded.teacher_id, rows.teacher1.id);

    const rowValues = await Student.objects.values({ expand: ["school", "district"] });
    assert.equal(rowValues.length, 4);
    assert.equal(rowValues[0].school.district.name, "North");
  });
});

test("reverse manager supports default accessors, all/filter/get/create/values", async () => {
  await withDb(async (db) => {
    const models = await defineSchoolModels(db);
    const rows = await seedSchoolData(models);

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
    assert.equal((await created.school).id, rows.school1.id);

    const values = await rows.school1.student_set.values({ fkDepth: 0 });
    assert.ok(values.some((v) => v.name === "学生5" && v.school_id === rows.school1.id));
  });
});

test("relatedName can customize or disable reverse accessors", async () => {
  await withDb(async (db) => {
    const Parent = await Model.define({
      table: "parents",
      fields: {
        id: { type: "number", primaryKey: true },
        name: { type: "char", max_length: 255 },
      },
    });
    const Child = await Model.define({
      table: "children",
      fields: {
        id: { type: "number", primaryKey: true },
        name: { type: "char", max_length: 255 },
        parent: { type: "fk", relatedModel: Parent, relatedName: "children" },
      },
    });
    await Model.define({
      table: "hidden_children",
      fields: {
        id: { type: "number", primaryKey: true },
        name: { type: "char", max_length: 255 },
        parent: { type: "fk", relatedModel: Parent, relatedName: "+" },
      },
    });

    await db.ensureTable(Parent);
    await db.ensureTable(Child);

    const parent = await Parent.objects.create({ name: "家长1" });
    await Child.objects.create({ name: "孩子1", parent });

    assert.equal(typeof parent.children.all, "function");
    assert.equal(Object.prototype.hasOwnProperty.call(Parent.prototype, "hidden_child_set"), false);
    assert.deepEqual((await parent.children.all()).map((c) => c.name), ["孩子1"]);
  });
});

test("duplicate reverse accessors fail fast during model definition", async () => {
  await withDb(async () => {
    const Parent = await Model.define({
      table: "parents",
      fields: {
        id: { type: "number", primaryKey: true },
        name: { type: "char", max_length: 255 },
      },
    });
    await Model.define({
      table: "first_children",
      fields: {
        id: { type: "number", primaryKey: true },
        parent: { type: "fk", relatedModel: Parent, relatedName: "children" },
      },
    });

    await assert.rejects(
      () =>
        Model.define({
          table: "second_children",
          fields: {
            id: { type: "number", primaryKey: true },
            parent: { type: "fk", relatedModel: Parent, relatedName: "children" },
          },
        }),
      /reverse "children"|prototype already has this property/i
    );
  });
});

test("custom managers can narrow default query behavior without replacing objects", async () => {
  await withDb(async (db) => {
    const models = await defineSchoolModels(db);
    await seedSchoolData(models);
    const { School } = models;

    assert.equal(School.objects instanceof Manager, true);
    assert.equal(School.big_school instanceof BigSchoolManager, true);

    assert.deepEqual(
      (await School.big_school.all()).map((s) => s.name).sort(),
      ["学校1", "学校3"]
    );
    assert.deepEqual(
      (await School.big_school.filter({ district: 1 })).map((s) => s.name).sort(),
      ["学校1", "学校3"]
    );
  });
});

test("objects.get throws DoesNotExist when no row matches", async () => {
  await withDb(async (db) => {
    const models = await defineSchoolModels(db);
    await seedSchoolData(models);

    await assert.rejects(() => models.Student.objects.get({ id: 999 }), /DoesNotExist/);
  });
});

test("create can rely entirely on database defaults", async () => {
  await withDb(async (db) => {
    const Thing = await Model.define({
      table: "things",
      fields: {
        id: { type: "number", primaryKey: true },
        name: { type: "char", max_length: 255, default: "untitled" },
        count: { type: "number", default: 0 },
      },
    });
    await db.ensureTable(Thing);

    const thing = await Thing.objects.create({});
    assert.equal(thing.name, "untitled");
    assert.equal(thing.count, 0);
  });
});

test("filter accepts a related model instance for FK fields", async () => {
  await withDb(async (db) => {
    const models = await defineSchoolModels(db);
    const rows = await seedSchoolData(models);

    const students = await models.Student.objects.filter({ school: rows.school1 });
    assert.deepEqual(
      students.map((s) => s.name).sort(),
      ["学生1", "学生3"]
    );
  });
});

test("filter({ field: null }) uses SQL IS NULL semantics", async () => {
  await withDb(async (db) => {
    const models = await defineSchoolModels(db);
    await seedSchoolData(models);

    const students = await models.Student.objects.filter({ teacher: null });
    assert.deepEqual(students.map((s) => s.name), ["学生2"]);
  });
});

test("get throws MultipleObjectsReturned when more than one row matches", async () => {
  await withDb(async (db) => {
    const models = await defineSchoolModels(db);
    const rows = await seedSchoolData(models);

    await assert.rejects(
      () => models.Student.objects.get({ school: rows.school1.id }),
      /MultipleObjectsReturned/
    );
  });
});

test("QuerySet exposes count, exclude, orderBy, update, and delete", async () => {
  await withDb(async (db) => {
    const models = await defineSchoolModels(db);
    await seedSchoolData(models);

    const queryset = models.Student.objects.filter({ age: { $gte: 16 } });
    assert.equal(await queryset.count(), 4);
    assert.deepEqual(
      (await queryset.exclude({ age: { $lt: 18 } })).map((s) => s.name).sort(),
      ["学生1", "学生3"]
    );
    assert.deepEqual((await queryset.orderBy("-age")).map((s) => s.name), [
      "学生3",
      "学生1",
      "学生2",
      "学生4",
    ]);
    assert.equal(await queryset.update({ sex: "U" }), 4);
    assert.equal(await queryset.delete(), 4);
  });
});

test("QuerySet update/delete reject non-filter modifiers to keep single-SQL mutations", async () => {
  await withDb(async (db) => {
    const models = await defineSchoolModels(db);
    await seedSchoolData(models);
    const qs = models.Student.objects.filter({ age: { $gte: 16 } });

    await assert.rejects(
      () => qs.orderBy("-age").update({ sex: "X" }),
      /only supports plain filter\(\) conditions/
    );
    await assert.rejects(
      () => qs.exclude({ age: { $lt: 18 } }).delete(),
      /only supports plain filter\(\) conditions/
    );
  });
});
