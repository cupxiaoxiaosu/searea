import { buildWhere as _buildWhere } from "../db-adapters/_common.js";

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
      selectRelated = [],
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
    this._selectRelated = [...selectRelated];
  }

  filter(extraWhere = {}) {
    return new QuerySet(this.modelClass, { ...this.where, ...normalizeWhereForModel(this.modelClass, extraWhere) }, {
      excludes: this.excludes,
      orderings: this.orderings,
      limit: this.limitCount,
      offset: this.offsetCount,
      outputMode: this.outputMode,
      valuesOpts: this.valuesOpts,
      selectRelated: this._selectRelated,
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
      selectRelated: this._selectRelated,
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
      selectRelated: this._selectRelated,
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
      selectRelated: this._selectRelated,
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
      selectRelated: this._selectRelated,
    });
  }

  /**
   * 与 Django 的 select_related() 一致：通过 SQL JOIN 一次性加载 FK 关联对象。
   * 消除 N+1 查询问题。
   *
   * @param {...string} fields - FK 字段名列表
   * @returns {QuerySet} 新的 QuerySet
   *
   * @example
   * // 1 次 SQL JOIN，而非 N+1 查询
   * const students = await Student.objects.selectRelated('school', 'teacher').filter({ age: { $gte: 16 } });
   */
  selectRelated(...fields) {
    const names = fields.flat().map((f) => String(f).trim()).filter(Boolean);
    return new QuerySet(this.modelClass, this.where, {
      excludes: this.excludes,
      orderings: this.orderings,
      limit: this.limitCount,
      offset: this.offsetCount,
      outputMode: this.outputMode,
      valuesOpts: this.valuesOpts,
      selectRelated: [...this._selectRelated, ...names],
    });
  }

  /**
   * 将 where + excludes 合并为单个 where 对象，exclude 转为 $ne/$nin。
   * 与 Django 一致：exclude() 翻译为 SQL NOT 条件。
   */
  _buildCombinedWhere() {
    const combined = { ...this.where };
    for (const clause of this.excludes) {
      for (const [key, value] of Object.entries(clause)) {
        if (value === null) {
          combined[key] = { $ne: null };
        } else if (value && typeof value === "object" && !Array.isArray(value)) {
          if ("$in" in value) {
            combined[key] = { $nin: value.$in };
          } else if ("$ne" in value) {
            combined[key] = value.$ne;
          } else if ("$gte" in value) {
            combined[key] = { $lt: value.$gte };
          } else if ("$gt" in value) {
            combined[key] = { $lte: value.$gt };
          } else if ("$lte" in value) {
            combined[key] = { $gt: value.$lte };
          } else if ("$lt" in value) {
            combined[key] = { $gte: value.$lt };
          } else if ("$nin" in value) {
            combined[key] = { $in: value.$nin };
          }
        } else {
          combined[key] = { $ne: value };
        }
      }
    }
    return combined;
  }

  _quoteIdent() {
    return this.modelClass.db.dialect === "mysql" ? (s) => `\`${s}\`` : (s) => `"${s}"`;
  }

  /**
   * 构建 ORDER BY SQL 片段
   */
  _buildOrderBySql() {
    if (this.orderings.length === 0) return "";
    const q = this._quoteIdent();
    return " ORDER BY " + this.orderings
      .map((o) => `${q(this.modelClass.table)}.${q(o.field)} ${o.direction === -1 ? "DESC" : "ASC"}`)
      .join(", ");
  }

  /**
   * 构建 JOIN SQL：SELECT 主表字段 + 关联表字段，LEFT JOIN。
   * 返回 { sql, params, joinAliases } 其中 joinAliases 是 { fkField: alias } 映射。
   */
  _buildJoinSql(combinedWhere) {
    const q = this._quoteIdent();
    const mainTable = this.modelClass.table;
    const mainFields = this.modelClass.fields ?? {};

    // JOIN 的 FK 字段
    const joinFields = this._selectRelated.filter((name) => mainFields[name]?.type === "fk");
    if (joinFields.length === 0) return null;

    // 生成别名：fkField → `${fkField}__${relatedTable}`
    const joinAliases = {};
    for (const name of joinFields) {
      joinAliases[name] = `${name}__${mainFields[name].relatedModel.table}`;
    }

    // SELECT 子句：主表所有字段 + 各 JOIN 表所有字段
    const selectParts = [];
    // 主表字段
    for (const fname of Object.keys(mainFields)) {
      if (mainFields[fname]?.type === "fk" || mainFields[fname]?.type === "m2m") {
        // FK 列名就是字段名本身（存的是 id）
        selectParts.push(`${q(mainTable)}.${q(fname)} AS ${q(`__${fname}`)}`);
      } else if (fname === "id" || mainFields[fname]?.primaryKey) {
        selectParts.push(`${q(mainTable)}.${q(fname)} AS ${q(`__${fname}`)}`);
      } else {
        selectParts.push(`${q(mainTable)}.${q(fname)} AS ${q(`__${fname}`)}`);
      }
    }
    // JOIN 表字段
    for (const name of joinFields) {
      const RelatedModel = mainFields[name].relatedModel;
      const alias = joinAliases[name];
      const relatedFields = RelatedModel.fields ?? {};
      for (const rfname of Object.keys(relatedFields)) {
        if (relatedFields[rfname]?.type === "fk" || relatedFields[rfname]?.type === "m2m") continue;
        selectParts.push(`${q(alias)}.${q(rfname)} AS ${q(`${name}__${rfname}`)}`);
      }
    }

    // FROM + JOIN
    let fromSql = `FROM ${q(mainTable)}`;
    for (const name of joinFields) {
      const RelatedModel = mainFields[name].relatedModel;
      const alias = joinAliases[name];
      fromSql += ` LEFT JOIN ${q(RelatedModel.table)} AS ${q(alias)} ON ${q(mainTable)}.${q(name)} = ${q(alias)}.${q("id")}`;
    }

    // WHERE（WHERE 子句中的列名需要限定主表）
    const w = _buildWhere(q, combinedWhere);
    // _buildWhere 生成的 WHERE 子句用的是裸列名，需要加上主表前缀
    let whereSql = w.sql;
    for (const fname of Object.keys(mainFields)) {
      if (fname === "$or" || fname === "$and") continue;
      // 将 WHERE "field" 替换为 WHERE "mainTable"."field"
      whereSql = whereSql.replace(new RegExp(`"${fname}"`, "g"), `${q(mainTable)}.${q(fname)}`);
    }

    return {
      selectClause: `SELECT ${selectParts.join(", ")}`,
      fromClause: fromSql,
      whereSql,
      params: w.params,
      joinFields,
      joinAliases,
    };
  }

  /**
   * 从 JOIN 结果行中拆分出主表和各关联表的字段，
   * 构造预填充 FK 的模型实例。
   */
  _parseJoinRows(rows, joinInfo) {
    const { joinFields, joinAliases } = joinInfo;
    const mainFields = this.modelClass.fields ?? {};

    return rows.map((row) => {
      // 拆分主表字段
      const mainAttrs = {};
      for (const fname of Object.keys(mainFields)) {
        const key = `__${fname}`;
        if (key in row) {
          mainAttrs[fname] = row[key];
        }
      }

      const instance = new this.modelClass(mainAttrs);

      // 预填充 FK 关联对象
      for (const name of joinFields) {
        const RelatedModel = mainFields[name].relatedModel;
        const relatedFields = RelatedModel.fields ?? {};
        const relatedAttrs = {};
        let hasData = false;
        for (const rfname of Object.keys(relatedFields)) {
          if (relatedFields[rfname]?.type === "fk" || relatedFields[rfname]?.type === "m2m") continue;
          const key = `${name}__${rfname}`;
          if (key in row) {
            relatedAttrs[rfname] = row[key];
            if (rfname === "id" && row[key] != null) hasData = true;
          }
        }
        if (hasData) {
          // 预填充：创建关联模型实例并直接挂到 fkIds + 缓存
          const relatedInstance = new RelatedModel(relatedAttrs);
          // 用 Symbol 直接写入 fkIds
          const fkIdsSym = Object.getOwnPropertySymbols(relatedInstance).find((s) => s.description === "fkIds");
          // 预填充到主实例：设置 fkIds 和一个缓存标记
          const instFkIds = Object.getOwnPropertySymbols(instance).find((s) => s.description === "fkIds");
          if (instFkIds) {
            instance[instFkIds][name] = relatedInstance.id;
          }
          // 挂载预加载的关联对象到实例上（覆盖 getter）
          Object.defineProperty(instance, `_prefetched_${name}`, {
            value: relatedInstance,
            enumerable: false,
            configurable: true,
            writable: true,
          });
        }
      }

      return instance;
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
    const combinedWhere = this._buildCombinedWhere();

    // 尝试 selectRelated JOIN 路径
    if (this._selectRelated.length > 0) {
      const joinInfo = this._buildJoinSql(combinedWhere);
      if (joinInfo) {
        let sql = `${joinInfo.selectClause} ${joinInfo.fromClause} ${joinInfo.whereSql}${this._buildOrderBySql()}`;
        if (typeof this.limitCount === "number") sql += ` LIMIT ${this.limitCount}`;
        if (typeof this.offsetCount === "number") sql += ` OFFSET ${this.offsetCount}`;
        const rows = await this.modelClass.db.rawAll(sql, joinInfo.params);
        const instances = this._parseJoinRows(rows, joinInfo);
        if (this.outputMode === "values") {
          return Promise.all(instances.map((inst) => this.modelClass.serialize(inst, this.valuesOpts)));
        }
        return instances;
      }
    }

    // 常规路径：无 JOIN
    const canUseDbOrderBy = this.orderings.length > 0;
    const opts = {};
    if (typeof this.limitCount === "number") opts.limit = this.limitCount;
    if (typeof this.offsetCount === "number") opts.offset = this.offsetCount;

    let rows;
    if (canUseDbOrderBy) {
      const q = this._quoteIdent();
      const w = _buildWhere(q, combinedWhere);
      let sql = `SELECT * FROM ${q(this.modelClass.table)} ${w.sql}${this._buildOrderBySql()}`;
      if (typeof this.limitCount === "number") sql += ` LIMIT ${this.limitCount}`;
      if (typeof this.offsetCount === "number") sql += ` OFFSET ${this.offsetCount}`;
      rows = await this.modelClass.db.rawAll(sql, w.params);
    } else {
      rows = await this.modelClass.db.select(this.modelClass.table, combinedWhere, opts);
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
      this.limitCount == null &&
      this.offsetCount == null
    );
  }

  /**
   * 返回总记录数（忽略 limit/offset）。
   * 与 Django 一致：exclude 翻译为 SQL NOT，orderBy 不影响计数。
   */
  async count() {
    const combinedWhere = this._buildCombinedWhere();
    return this.modelClass.db.count(this.modelClass.table, combinedWhere);
  }

  /**
   * 便捷分页方法。
   * @param {number} page - 页码，从1开始
   * @param {number} pageSize - 每页条数
   * @returns {Promise<{ list: Array, total: number, page: number, pageSize: number, totalPages: number }>}
   */
  async page(page = 1, pageSize = 20) {
    const total = await this.count();
    const totalPages = Math.ceil(total / pageSize) || 0;
    const offset = (page - 1) * pageSize;
    const list = await this.offset(offset).limit(pageSize).values(this.valuesOpts);
    return { list, total, page, pageSize, totalPages };
  }

  async sum(fieldName) {
    this._assertAggregateNumberField(fieldName, "sum");
    if (typeof this.modelClass.db.sum !== "function" || !this._canPushAggregatesToDb()) {
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
    const combinedWhere = this._buildCombinedWhere();
    return this.modelClass.db.sum(this.modelClass.table, fieldName, combinedWhere);
  }

  async avg(fieldName) {
    this._assertAggregateNumberField(fieldName, "avg");
    if (typeof this.modelClass.db.avg !== "function" || !this._canPushAggregatesToDb()) {
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
    const combinedWhere = this._buildCombinedWhere();
    return this.modelClass.db.avg(this.modelClass.table, fieldName, combinedWhere);
  }

  async update(attrs = {}) {
    if (this.orderings.length > 0 || this.limitCount != null || this.offsetCount != null) {
      throw new Error(
        "QuerySet.update() only supports plain filter()/exclude() conditions; orderBy/limit/offset are not allowed"
      );
    }
    const combinedWhere = this._buildCombinedWhere();
    const normalizedAttrs = normalizeWhereForModel(this.modelClass, attrs ?? {});
    const keys = Object.keys(normalizedAttrs).filter((key) => normalizedAttrs[key] !== undefined);
    if (keys.length === 0) return 0;
    return this.modelClass.db.update(
      this.modelClass.table,
      combinedWhere,
      Object.fromEntries(keys.map((key) => [key, normalizedAttrs[key]]))
    );
  }

  async delete() {
    if (this.orderings.length > 0 || this.limitCount != null || this.offsetCount != null) {
      throw new Error(
        "QuerySet.delete() only supports plain filter()/exclude() conditions; orderBy/limit/offset are not allowed"
      );
    }
    const combinedWhere = this._buildCombinedWhere();
    return this.modelClass.db.delete(this.modelClass.table, combinedWhere);
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
      selectRelated: this._selectRelated,
    });
  }
}
