import { QuerySet, normalizeWhereForModel } from "./queryset.js";

/** 已挂在 relatedModel.prototype 上的反向 accessor 名，避免重复注册 */
const reverseAccessorsInstalled = Symbol("reverseAccessorsInstalled");

/** relatedName "+" → 无反向；否则显式名；默认按表名：`students` → `student_set`。 */
export function resolveReverseAccessorName(childModel, fkDef) {
  const rn = fkDef.relatedName;
  if (rn === "+") return null;
  if (rn) return String(rn);
  let t = childModel.table;
  if (t.endsWith("s")) t = t.slice(0, -1);
  return `${t}_set`;
}

export function installReverseAccessor(relatedModel, accessorName, { childModel, fkFieldName }) {
  let set = relatedModel[reverseAccessorsInstalled];
  if (!set) {
    set = new Set();
    relatedModel[reverseAccessorsInstalled] = set;
  }
  if (set.has(accessorName)) {
    throw new Error(
      `Reverse accessor "${accessorName}" on ${relatedModel.name ?? relatedModel.table} already exists (FK from ${childModel.table})`
    );
  }
  set.add(accessorName);

  Object.defineProperty(relatedModel.prototype, accessorName, {
    configurable: true,
    enumerable: false,
    get() {
      return new ReverseManager(this, childModel, fkFieldName);
    },
  });
}

/** Django-ish reverse manager: `await school.student_set.all()` */
export class ReverseManager {
  constructor(parentInstance, childModel, fkFieldName) {
    this.parentInstance = parentInstance;
    this.childModel = childModel;
    this.fkFieldName = fkFieldName;
  }

  _baseWhere() {
    const pid = this.parentInstance.id;
    if (pid === undefined || pid === null) {
      return { id: { $in: [] } };
    }
    return { [this.fkFieldName]: pid };
  }

  all() {
    return this.childModel.objects.filter(this._baseWhere());
  }

  filter(where = {}) {
    return this.childModel.objects.filter({ ...this._baseWhere(), ...where });
  }

  values(opts = {}) {
    return this.all().values(opts);
  }

  create(attrs = {}) {
    return this.childModel.objects.create({
      ...attrs,
      [this.fkFieldName]: this.parentInstance.id,
    });
  }

  async get(where = {}) {
    return this.childModel.objects.get({ ...this._baseWhere(), ...where });
  }
}

export class ManyToManyManager {
  constructor(parentInstance, { relatedModel, throughModel, sourceFieldName, targetFieldName }) {
    this.parentInstance = parentInstance;
    this.relatedModel = relatedModel;
    this.throughModel = throughModel;
    this.sourceFieldName = sourceFieldName;
    this.targetFieldName = targetFieldName;
  }

  _parentId() {
    return this.parentInstance.id;
  }

  _idOf(value) {
    return value && typeof value === "object" ? value.id : value;
  }

  async _targetIds() {
    const pid = this._parentId();
    if (pid === undefined || pid === null) return [];
    const rows = await this.throughModel.db.select(this.throughModel.table, {
      [this.sourceFieldName]: pid,
    });
    return rows.map((row) => row[this.targetFieldName]).filter((id) => id !== undefined && id !== null);
  }

  async all() {
    const ids = await this._targetIds();
    if (ids.length === 0) return [];
    return this.relatedModel.objects.filter({ id: { $in: ids } });
  }

  async values(opts = {}) {
    const rows = await this.all();
    return Promise.all(rows.map((row) => this.relatedModel.serialize(row, opts)));
  }

  async add(...values) {
    const pid = this._parentId();
    if (pid === undefined || pid === null) {
      throw new Error("Cannot add m2m relations before the source instance has an id");
    }
    const ids = values.flat().map((value) => this._idOf(value)).filter((id) => id !== undefined && id !== null);
    if (ids.length === 0) return 0;

    const existing = new Set(await this._targetIds());
    let created = 0;
    for (const id of ids) {
      if (existing.has(id)) continue;
      await this.throughModel.objects.create({
        [this.sourceFieldName]: pid,
        [this.targetFieldName]: id,
      });
      existing.add(id);
      created += 1;
    }
    return created;
  }

  async remove(...values) {
    const pid = this._parentId();
    if (pid === undefined || pid === null) return 0;
    const ids = values.flat().map((value) => this._idOf(value)).filter((id) => id !== undefined && id !== null);
    let deleted = 0;
    for (const id of ids) {
      deleted += await this.throughModel.db.delete(this.throughModel.table, {
        [this.sourceFieldName]: pid,
        [this.targetFieldName]: id,
      });
    }
    return deleted;
  }

  async clear() {
    const pid = this._parentId();
    if (pid === undefined || pid === null) return 0;
    return this.throughModel.db.delete(this.throughModel.table, {
      [this.sourceFieldName]: pid,
    });
  }

  async set(values = []) {
    await this.clear();
    return this.add(...values);
  }
}

export class Manager {
  constructor(modelClass) {
    this.modelClass = modelClass;
  }

  /**
   * Django: Model.objects.all() → QuerySet (lazy).
   */
  all() {
    return new QuerySet(this.modelClass, {});
  }

  filter(where = {}) {
    return new QuerySet(this.modelClass, normalizeWhereForModel(this.modelClass, where));
  }

  exclude(where = {}) {
    return this.all().exclude(where);
  }

  orderBy(...fields) {
    return this.all().orderBy(...fields);
  }

  /**
   * Django: Model.objects.select_related('fk1', 'fk2')
   * 通过 SQL JOIN 一次性加载 FK 关联对象，消除 N+1 查询。
   */
  selectRelated(...fields) {
    return this.all().selectRelated(...fields);
  }

  /** `Student.objects.values()` → same as `.all().values()` */
  values(opts = {}) {
    return this.all().values(opts);
  }

  async create(attrs) {
    // Allow passing fk object: { school: schoolObj } → insert uses schoolObj.id.
    const normalized = normalizeWhereForModel(this.modelClass, attrs ?? {});
    const fields = this.modelClass.fields ?? {};
    const m2mAttrs = {};

    for (const [fieldName, fieldDef] of Object.entries(fields)) {
      if (Object.prototype.hasOwnProperty.call(normalized, fieldName)) {
        continue;
      }

      if (Object.prototype.hasOwnProperty.call(fieldDef, "default")) {
        normalized[fieldName] = fieldDef.default;
      }
    }

    for (const key of Object.keys(normalized)) {
      if (normalized[key] === undefined) {
        delete normalized[key];
        continue;
      }
      if (fields[key]?.type === "m2m") {
        m2mAttrs[key] = normalized[key];
        delete normalized[key];
      }
    }

    const row = await this.modelClass.db.insert(this.modelClass.table, normalized);
    const instance = new this.modelClass(row);
    for (const [fieldName, value] of Object.entries(m2mAttrs)) {
      await instance[fieldName].set(Array.isArray(value) ? value : [value]);
    }
    return instance;
  }

  async get(where = {}) {
    const normalizedWhere = normalizeWhereForModel(this.modelClass, where);
    const rows = await this.modelClass.db.select(this.modelClass.table, normalizedWhere, { limit: 2 });
    if (rows.length === 0) return null;
    if (rows.length > 1) throw new Error("MultipleObjectsReturned");
    return new this.modelClass(rows[0]);
  }
}
