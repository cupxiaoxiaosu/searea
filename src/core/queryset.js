function isOperatorObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.keys(value).some((k) => k.startsWith("$"));
}

function normalizeSingleValue(fieldDef, value) {
  if (fieldDef?.type !== "fk") return value;
  if (value && typeof value === "object" && !Array.isArray(value) && !isOperatorObject(value)) {
    return value.id;
  }
  if (value && typeof value === "object" && value.$in && Array.isArray(value.$in)) {
    return {
      ...value,
      $in: value.$in.map((item) =>
        item && typeof item === "object" && !Array.isArray(item) ? item.id : item
      ),
    };
  }
  return value;
}

export function normalizeWhereForModel(modelClass, where = {}) {
  const out = {};
  const fields = modelClass.fields ?? {};
  for (const [key, value] of Object.entries(where ?? {})) {
    out[key] = normalizeSingleValue(fields[key], value);
  }
  return out;
}

function rowMatchesWhere(row, where = {}) {
  for (const [key, value] of Object.entries(where ?? {})) {
    const rv = row[key];
    if (value === null) {
      if (rv !== null && rv !== undefined) return false;
      continue;
    }

    if (value && typeof value === "object" && !Array.isArray(value)) {
      if ("$in" in value) {
        if (!Array.isArray(value.$in) || value.$in.length === 0) return false;
        if (!value.$in.includes(rv)) return false;
        continue;
      }
      if ("$gte" in value) {
        if (!(rv >= value.$gte)) return false;
        continue;
      }
      if ("$gt" in value) {
        if (!(rv > value.$gt)) return false;
        continue;
      }
      if ("$lte" in value) {
        if (!(rv <= value.$lte)) return false;
        continue;
      }
      if ("$lt" in value) {
        if (!(rv < value.$lt)) return false;
        continue;
      }
    }

    if (rv !== value) return false;
  }
  return true;
}

function compareByOrderings(a, b, orderings) {
  for (const { field, direction } of orderings) {
    const av = a[field];
    const bv = b[field];
    if (av === bv) continue;
    if (av == null) return 1 * direction;
    if (bv == null) return -1 * direction;
    if (av > bv) return 1 * direction;
    if (av < bv) return -1 * direction;
  }
  return 0;
}

/**
 * Lazy querysets: `await qs` → model rows; `await qs.values()` → plain dict rows.
 */
export class QuerySet {
  constructor(
    modelClass,
    where = {},
    {
      excludes = [],
      orderings = [],
      limit = null,
      offset = null,
      outputMode = "models",
      valuesOpts = { fkDepth: 1 },
    } = {}
  ) {
    this.modelClass = modelClass;
    this.where = normalizeWhereForModel(modelClass, where);
    this.excludes = excludes.map((clause) => normalizeWhereForModel(modelClass, clause));
    this.orderings = [...orderings];
    this.limitCount = limit;
    this.offsetCount = offset;
    this.outputMode = outputMode;
    this.valuesOpts = valuesOpts;
  }

  filter(extraWhere = {}) {
    return new QuerySet(this.modelClass, { ...this.where, ...normalizeWhereForModel(this.modelClass, extraWhere) }, {
      excludes: this.excludes,
      orderings: this.orderings,
      limit: this.limitCount,
      offset: this.offsetCount,
      outputMode: this.outputMode,
      valuesOpts: this.valuesOpts,
    });
  }

  exclude(extraWhere = {}) {
    return new QuerySet(this.modelClass, this.where, {
      excludes: [...this.excludes, normalizeWhereForModel(this.modelClass, extraWhere)],
      orderings: this.orderings,
      limit: this.limitCount,
      offset: this.offsetCount,
      outputMode: this.outputMode,
      valuesOpts: this.valuesOpts,
    });
  }

  orderBy(...fields) {
    const orderings = fields
      .flat()
      .map((f) => String(f))
      .filter(Boolean)
      .map((f) =>
        f.startsWith("-")
          ? { field: f.slice(1), direction: -1 }
          : { field: f, direction: 1 }
      );
    return new QuerySet(this.modelClass, this.where, {
      excludes: this.excludes,
      orderings,
      limit: this.limitCount,
      offset: this.offsetCount,
      outputMode: this.outputMode,
      valuesOpts: this.valuesOpts,
    });
  }

  limit(count) {
    return new QuerySet(this.modelClass, this.where, {
      excludes: this.excludes,
      orderings: this.orderings,
      limit: count,
      offset: this.offsetCount,
      outputMode: this.outputMode,
      valuesOpts: this.valuesOpts,
    });
  }

  offset(count) {
    return new QuerySet(this.modelClass, this.where, {
      excludes: this.excludes,
      orderings: this.orderings,
      limit: this.limitCount,
      offset: count,
      outputMode: this.outputMode,
      valuesOpts: this.valuesOpts,
    });
  }

  /**
   * Django-ish lazy queryset evaluation hook for JS:
   * `await queryset` resolves to an array of Model instances.
   */
  then(onFulfilled, onRejected) {
    return this.evaluate().then(onFulfilled, onRejected);
  }

  async evaluate() {
    let rows = await this.modelClass.db.select(this.modelClass.table, this.where);
    if (this.excludes.length > 0) {
      rows = rows.filter((row) => this.excludes.every((clause) => !rowMatchesWhere(row, clause)));
    }
    if (this.orderings.length > 0) {
      rows.sort((a, b) => compareByOrderings(a, b, this.orderings));
    }
    if (typeof this.offsetCount === "number" && this.offsetCount > 0) {
      rows = rows.slice(this.offsetCount);
    }
    if (typeof this.limitCount === "number") {
      rows = rows.slice(0, this.limitCount);
    }
    const instances = rows.map((r) => new this.modelClass(r));
    if (this.outputMode === "values") {
      return Promise.all(instances.map((inst) => this.modelClass.serialize(inst, this.valuesOpts)));
    }
    return instances;
  }

  /**
   * Optional chaining helper (not required if you `await queryset`).
   * Note: Django doesn't expose `.all()` on QuerySet; we keep it as sugar.
   */
  async all() {
    return this.evaluate();
  }

  async first() {
    const rows = await this.limit(1).evaluate();
    return rows[0] ?? null;
  }

  _assertAggregateNumberField(fieldName, op) {
    const def = this.modelClass.fields?.[fieldName];
    if (!def) {
      throw new Error(`QuerySet.${op}(): unknown field "${fieldName}"`);
    }
    if (def.type !== "number") {
      throw new Error(`QuerySet.${op}(): field "${fieldName}" must have type "number"`);
    }
  }

  _canPushAggregatesToDb() {
    return (
      this.excludes.length === 0 &&
      this.orderings.length === 0 &&
      this.limitCount == null &&
      this.offsetCount == null
    );
  }

  async count() {
    if (
      this.excludes.length === 0 &&
      this.orderings.length === 0 &&
      this.limitCount == null &&
      this.offsetCount == null
    ) {
      return this.modelClass.db.count(this.modelClass.table, this.where);
    }
    const rows = await this.evaluate();
    return rows.length;
  }

  async sum(fieldName) {
    this._assertAggregateNumberField(fieldName, "sum");
    if (
      typeof this.modelClass.db.sum !== "function" ||
      !this._canPushAggregatesToDb()
    ) {
      const rows = await this.evaluate();
      let total = 0;
      let any = false;
      for (const inst of rows) {
        const v = inst[fieldName];
        if (v == null) continue;
        total += Number(v);
        any = true;
      }
      return any ? total : null;
    }
    return this.modelClass.db.sum(this.modelClass.table, fieldName, this.where);
  }

  async avg(fieldName) {
    this._assertAggregateNumberField(fieldName, "avg");
    if (
      typeof this.modelClass.db.avg !== "function" ||
      !this._canPushAggregatesToDb()
    ) {
      const rows = await this.evaluate();
      let total = 0;
      let n = 0;
      for (const inst of rows) {
        const v = inst[fieldName];
        if (v == null) continue;
        total += Number(v);
        n += 1;
      }
      return n === 0 ? null : total / n;
    }
    return this.modelClass.db.avg(this.modelClass.table, fieldName, this.where);
  }

  async update(attrs = {}) {
    if (this.excludes.length > 0 || this.orderings.length > 0 || this.limitCount != null || this.offsetCount != null) {
      throw new Error(
        "QuerySet.update() only supports plain filter() conditions; exclude/orderBy/limit/offset are not allowed"
      );
    }
    const normalizedAttrs = normalizeWhereForModel(this.modelClass, attrs ?? {});
    const keys = Object.keys(normalizedAttrs).filter((key) => normalizedAttrs[key] !== undefined);
    if (keys.length === 0) return 0;
    return this.modelClass.db.update(
      this.modelClass.table,
      this.where,
      Object.fromEntries(keys.map((key) => [key, normalizedAttrs[key]]))
    );
  }

  async delete() {
    if (this.excludes.length > 0 || this.orderings.length > 0 || this.limitCount != null || this.offsetCount != null) {
      throw new Error(
        "QuerySet.delete() only supports plain filter() conditions; exclude/orderBy/limit/offset are not allowed"
      );
    }
    return this.modelClass.db.delete(this.modelClass.table, this.where);
  }

  /**
   * Like Django `QuerySet.values()`: lazy; `await qs.values()` → list of plain dicts.
   * @param {{ fkDepth?: number } | number} [opts]
   */
  values(opts = {}) {
    const normalizedValuesOpts =
      typeof opts === "number" ? { fkDepth: opts } : { fkDepth: 1, ...opts };
    return new QuerySet(this.modelClass, this.where, {
      excludes: this.excludes,
      orderings: this.orderings,
      limit: this.limitCount,
      offset: this.offsetCount,
      outputMode: "values",
      valuesOpts: normalizedValuesOpts,
    });
  }
}
