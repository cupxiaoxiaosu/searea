import Model from "../core/model.js";

/**
 * @param {object} f — field AST
 * @param {Record<string, unknown>} out
 * @param {(v: unknown) => unknown} [mapDefault] — defaultValue 写入前映射（如 boolean → 0/1）
 */
function applyStandardFieldProps(f, out, mapDefault) {
  if (f.null) out.null = true;
  if ("defaultValue" in f) {
    const v = f.defaultValue;
    out.default = mapDefault ? mapDefault(v) : v;
  }
  const lb = f.label;
  if (typeof lb === "string" && lb.trim()) out.label = lb.trim();
}

/** @param {object} f @param {Record<string, unknown>} out */
function applyPrimaryKeyMaybe(f, out) {
  if (f.primaryKey) out.primaryKey = true;
}

/**
 * @param {object} f
 * @param {Record<string, unknown>} out
 */
function copyPatternChoicesFromAst(f, out) {
  if (typeof f.pattern === "string" && f.pattern.trim()) {
    out.pattern = f.pattern.trim();
  }
  if (Array.isArray(f.choices) && f.choices.length) {
    out.choices = f.choices;
  }
}

/**
 * @param {object} f — field AST node（含可选 `label`）
 * @param {Record<string, typeof Model>} modelsByTable
 * @param {string} tableName
 */
function compileField(f, modelsByTable, tableName) {
  const { name, fieldKind, maxLength } = f;

  if (fieldKind === "char") {
    if (typeof maxLength !== "number" || !Number.isFinite(maxLength)) {
      throw new Error(`<Table name="${tableName}"> CharField "${name}": maxLength is required`);
    }
    /** @type {Record<string, unknown>} */
    const out = { type: "char", max_length: maxLength };
    applyStandardFieldProps(f, out);
    applyPrimaryKeyMaybe(f, out);
    copyPatternChoicesFromAst(f, out);
    return out;
  }

  if (fieldKind === "text") {
    /** @type {Record<string, unknown>} */
    const out = { type: "text" };
    applyStandardFieldProps(f, out);
    copyPatternChoicesFromAst(f, out);
    return out;
  }

  if (fieldKind === "integer") {
    /** @type {Record<string, unknown>} */
    const out = { type: "number" };
    applyStandardFieldProps(f, out);
    applyPrimaryKeyMaybe(f, out);
    copyPatternChoicesFromAst(f, out);
    return out;
  }

  if (fieldKind === "boolean") {
    /** @type {Record<string, unknown>} */
    const out = { type: "number" };
    applyStandardFieldProps(f, out, (v) => (v === true ? 1 : v === false ? 0 : v));
    copyPatternChoicesFromAst(f, out);
    return out;
  }

  if (fieldKind === "date" || fieldKind === "datetime") {
    /** @type {Record<string, unknown>} */
    const out = { type: fieldKind };
    applyStandardFieldProps(f, out);
    return out;
  }

  if (fieldKind === "foreignKey") {
    /** @type {import("../core/model.js").default | undefined} */
    let related = undefined;

    if (typeof f.relatedTable === "string" && f.relatedTable) {
      related = modelsByTable[f.relatedTable];
      if (!related) {
        throw new Error(
          `<Table name="${tableName}"> ForeignKey "${name}": unknown relatedTable "${f.relatedTable}" (define <Table name="${f.relatedTable}"> earlier, or check spelling)`,
        );
      }
    } else if (typeof f.relatedModel === "function") {
      related = f.relatedModel();
      if (!related || typeof related !== "function" || !related.fields) {
        throw new Error(
          `<Table name="${tableName}"> ForeignKey "${name}": relatedModel() must return a Model class`,
        );
      }
    } else {
      throw new Error(`<Table name="${tableName}"> ForeignKey "${name}": relatedTable or relatedModel is required`);
    }

    /** @type {Record<string, unknown>} */
    const out = { type: "fk", relatedModel: related };
    applyStandardFieldProps(f, out);
    return out;
  }

  if (fieldKind === "manyToMany") {
    /** @type {import("../core/model.js").default | undefined} */
    let related = undefined;

    if (typeof f.relatedTable === "string" && f.relatedTable) {
      related = modelsByTable[f.relatedTable];
      if (!related) {
        throw new Error(
          `<Table name="${tableName}"> ManyToManyField "${name}": unknown relatedTable "${f.relatedTable}" (define <Table name="${f.relatedTable}"> earlier, or check spelling)`,
        );
      }
    } else if (typeof f.relatedModel === "function") {
      related = f.relatedModel();
      if (!related || typeof related !== "function" || !related.fields) {
        throw new Error(
          `<Table name="${tableName}"> ManyToManyField "${name}": relatedModel() must return a Model class`,
        );
      }
    } else {
      throw new Error(`<Table name="${tableName}"> ManyToManyField "${name}": relatedTable or relatedModel is required`);
    }

    /** @type {Record<string, unknown>} */
    const out = { type: "m2m", relatedModel: related };
    if (typeof f.through === "function") out.through = f.through;
    if (typeof f.throughTable === "string" && f.throughTable) out.throughTable = f.throughTable;
    applyStandardFieldProps(f, out);
    return out;
  }

  throw new Error(`Unknown field kind "${fieldKind}"`);
}

/**
 * @param {{ kind: string, tables?: unknown }} rootNode
 */
export async function compileSchema(rootNode) {
  if (!rootNode || rootNode.kind !== "database") {
    throw new Error("compileSchema: root must be <Database>");
  }

  const tables = rootNode.tables ?? [];
  /** @type {Record<string, typeof Model>} */
  const models = {};

  const seen = new Set();
  for (const t of tables) {
    const tn = /** @type {{ name?: string }} */ (t).name;
    if (!tn || typeof tn !== "string") {
      throw new Error("<Table>: name is required");
    }
    if (seen.has(tn)) {
      throw new Error(`<Table>: duplicate table name "${tn}"`);
    }
    seen.add(tn);
  }

  for (const t of tables) {
    const tableName = /** @type {{ name: string, fields: object[], events?: object }} */ (t).name;
    const fieldNodes = /** @type {object[]} */ (t.fields ?? []);
    /** @type {Record<string, unknown>} */
    const fields = {};
    const names = new Set();
    let pkCount = 0;

    for (const fn of fieldNodes) {
      const f = /** @type {{ name?: string, fieldKind?: string, primaryKey?: boolean }} */ (fn);
      if (!f.name || typeof f.name !== "string") {
        throw new Error(`<Table name="${tableName}">: field missing name`);
      }
      if (names.has(f.name)) {
        throw new Error(`<Table name="${tableName}">: duplicate field "${f.name}"`);
      }
      names.add(f.name);
      if (f.primaryKey) pkCount += 1;
    }

    if (pkCount > 1) {
      throw new Error(`<Table name="${tableName}">: only one primary key allowed`);
    }

    for (const fn of fieldNodes) {
      const f = fn;
      const fname = /** @type {{ name: string }} */ (f).name;
      fields[fname] = compileField(f, models, tableName);
    }

    const rawAdmin = /** @type {{ admin?: object }} */ (t).admin;
    const admin =
      rawAdmin && typeof rawAdmin === "object" && !Array.isArray(rawAdmin) ? { ...rawAdmin } : {};

    const te = /** @type {{ events?: Record<string, Function> }} */ (t).events;

    const rawManagers = /** @type {{ managers?: Record<string, Function> }} */ (t).managers;
    const managers =
      rawManagers && typeof rawManagers === "object" && !Array.isArray(rawManagers)
        ? { ...rawManagers }
        : undefined;

    class ConcreteModel extends Model {}
    await ConcreteModel.init({
      table: tableName,
      fields,
      admin,
      events: te && typeof te === "object" ? { ...te } : {},
      ...(managers ? { managers } : {}),
    });
    models[tableName] = ConcreteModel;
  }

  return { models, tables };
}
