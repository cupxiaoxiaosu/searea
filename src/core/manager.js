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

  /** `Student.objects.values()` → same as `.all().values()` */
  values(opts = {}) {
    return this.all().values(opts);
  }

  async create(attrs) {
    // Allow passing fk object: { school: schoolObj } → insert uses schoolObj.id.
    const normalized = normalizeWhereForModel(this.modelClass, attrs ?? {});
    const fields = this.modelClass.fields ?? {};

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
      }
    }

    const row = await this.modelClass.db.insert(this.modelClass.table, normalized);
    return new this.modelClass(row);
  }

  async get(where = {}) {
    const normalizedWhere = normalizeWhereForModel(this.modelClass, where);
    const rows = await this.modelClass.db.select(this.modelClass.table, normalizedWhere, { limit: 2 });
    if (rows.length === 0) throw new Error("DoesNotExist");
    if (rows.length > 1) throw new Error("MultipleObjectsReturned");
    return new this.modelClass(rows[0]);
  }
}
