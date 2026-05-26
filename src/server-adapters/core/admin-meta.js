/** @param {string} key */
export function guessModelName(key) {
  const base = key.length > 1 && key.endsWith("s") ? key.slice(0, -1) : key;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/** @param {Record<string, typeof import("../../core/model.js").Model>} modelsMap */
function resourceKeyForClass(modelsMap, ModelClass) {
  for (const [k, M] of Object.entries(modelsMap)) {
    if (M === ModelClass) return k;
  }
  return ModelClass.table;
}

/**
 * @param {string} fname
 * @param {object} def
 * @param {Record<string, typeof import("../../core/model.js").Model>} modelsMap
 * @param {Record<string, { admin?: { label?: string } }>} catalogByKey
 */
function fieldMetaEntry(fname, def, modelsMap, catalogByKey) {
  if (def?.primaryKey) {
    return {
      kind: "auto",
      label: def.label ?? "ID",
    };
  }
  fname = def.label || fname;
  if (def?.type === "fk") {
    const Related = def.relatedModel;
    const targetKey = resourceKeyForClass(modelsMap, Related);
    return {
      kind: "foreign_key",
      target: targetKey,
      label: fname,
    };
  }
  if (def?.type === "number") {
    /** @type {Record<string, unknown>} */
    const entry = { kind: "integer", label: fname };
    if (Array.isArray(def.choices)) entry.choices = def.choices;
    return entry;
  }
  if (def?.type === "date") {
    return { kind: "date", label: fname };
  }
  if (def?.type === "datetime") {
    return { kind: "datetime", label: fname };
  }
  if (def?.type === "char") {
    /** @type {Record<string, unknown>} */
    const entry = { kind: "char", label: fname, max_length: def.max_length };
    if (typeof def.pattern === "string" && def.pattern) entry.pattern = def.pattern;
    if (Array.isArray(def.choices)) entry.choices = def.choices;
    return entry;
  }
  if (def?.type === "text") {
    /** @type {Record<string, unknown>} */
    const entry = { kind: "text", label: fname };
    if (typeof def.pattern === "string" && def.pattern) entry.pattern = def.pattern;
    if (Array.isArray(def.choices)) entry.choices = def.choices;
    return entry;
  }
  return { kind: "char", label: fname };
}

/**
 * @param {string} resourceKey
 * @param {typeof import("../../core/model.js").Model} ModelClass
 * @param {Record<string, typeof import("../../core/model.js").Model>} modelsMap
 * @param {Record<string, { admin?: { label?: string } }>} catalogByKey
 */
export function buildReverseRelations(resourceKey, ModelClass, modelsMap, catalogByKey) {
  const out = [];
  for (const [otherKey, Other] of Object.entries(modelsMap)) {
    if (otherKey === resourceKey) continue;
    const fields = Other.fields ?? {};
    for (const [fname, fdef] of Object.entries(fields)) {
      if (fdef?.type === "fk" && fdef.relatedModel === ModelClass) {
        out.push({
          sourceTable: otherKey,
          fkField: fname,
          label: catalogByKey[otherKey]?.admin?.label ?? otherKey,
        });
      }
    }
  }
  return out;
}

/**
 * @param {string} resourceKey
 * @param {typeof import("../../core/model.js").Model} ModelClass
 * @param {Record<string, typeof import("../../core/model.js").Model>} modelsMap
 * @param {{ modelName?: string } | undefined} catalogRow
 * @param {Record<string, { admin?: { label?: string } }>} catalogByKey
 */
export function buildResourceMeta(resourceKey, ModelClass, modelsMap, catalogRow, catalogByKey) {
  const fields = {};
  for (const [fname, def] of Object.entries(ModelClass.fields ?? {})) {
    fields[fname] = fieldMetaEntry(fname, def, modelsMap, catalogByKey);
  }
  return {
    modelName: catalogRow?.modelName ?? guessModelName(resourceKey),
    table: ModelClass.table,
    fields,
    reverseRelations: buildReverseRelations(resourceKey, ModelClass, modelsMap, catalogByKey),
  };
}

/**
 * 从各模型类上的 `Model.admin` 生成 Admin 目录行。
 * 排序：有 `admin.order`（有限数字）的按升序，同级按 `key` 字母序；无 `order` 的按 `models` 对象键声明顺序排在后面。
 *
 * @param {Record<string, typeof import("../../core/model.js").Model>} modelsMap
 * @returns {Array<{ key: string, modelName: string, admin: object }>}
 */
export function adminCatalogFromModels(modelsMap) {
  const entries = Object.entries(modelsMap ?? {});
  const withOrder = [];
  const tail = [];
  for (let i = 0; i < entries.length; i++) {
    const [key, M] = entries[i];
    const adm = M?.admin;
    const o = adm && typeof adm === "object" && !Array.isArray(adm) ? adm.order : undefined;
    if (typeof o === "number" && Number.isFinite(o)) {
      withOrder.push({ key, M, i });
    } else {
      tail.push({ key, M, i });
    }
  }
  withOrder.sort((a, b) => {
    const ao = a.M.admin.order;
    const bo = b.M.admin.order;
    if (ao !== bo) return ao - bo;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
  tail.sort((a, b) => a.i - b.i);
  const ordered = [...withOrder, ...tail];
  return ordered.map(({ key, M }) => ({
    key,
    modelName: guessModelName(key),
    admin: M.admin && typeof M.admin === "object" && !Array.isArray(M.admin) ? { ...M.admin } : {},
  }));
}

/**
 * @param {Record<string, typeof import("../../core/model.js").Model>} modelsMap
 * @param {Array<{ key: string, modelName?: string, admin?: object }>} adminCatalog
 */
export function normalizeAdminCatalog(modelsMap, adminCatalog) {
  const keys = Object.keys(modelsMap);
  if (!adminCatalog?.length) {
    return keys.sort().map((key) => ({
      key,
      modelName: guessModelName(key),
      admin: {},
    }));
  }
  const seen = new Set(adminCatalog.map((r) => r.key));
  const missing = keys.filter((k) => !seen.has(k));
  const extra = missing.map((key) => ({
    key,
    modelName: guessModelName(key),
    admin: {},
  }));
  return [...adminCatalog, ...extra];
}

/**
 * @param {string} backendPath
 * @param {Record<string, typeof import("../../core/model.js").Model>} modelsMap
 * @param {Array<{ key: string, modelName?: string, admin?: object }>} catalogRows
 */
export function buildApiDocs(backendPath, modelsMap, catalogRows) {
  const prefix = backendPath.replace(/\/$/, "") || "/api";
  const models = [];
  for (const row of catalogRows) {
    const key = row.key;
    if (!modelsMap[key]) continue;
    const base = `${prefix}/${key}`;
    models.push({
      key,
      endpoints: [
        {
          method: "GET",
          path: base,
          description: "List records (optional pagination: page, pageSize; column filters as query params).",
          params: {},
          requestBody: null,
          responseBody: { items: [], total: 0, page: 1, pageSize: 20 },
          responseExamples: [
            {
              label: "Paged list",
              queryString: "page=1&pageSize=20",
              responseBody: { items: [], total: 0, page: 1, pageSize: 20 },
            },
          ],
        },
        {
          method: "GET",
          path: `${base}/:id`,
          description: "Retrieve one row by primary key.",
          params: { id: "Primary key" },
          requestBody: null,
          responseBody: {},
        },
        {
          method: "POST",
          path: base,
          description: "Create a row.",
          params: {},
          requestBody: {},
          responseBody: {},
        },
        {
          method: "PUT",
          path: `${base}/:id`,
          description: "Update a row (same fields as PATCH).",
          params: { id: "Primary key" },
          requestBody: {},
          responseBody: {},
        },
        {
          method: "PATCH",
          path: `${base}/:id`,
          description: "Partial update.",
          params: { id: "Primary key" },
          requestBody: {},
          responseBody: {},
        },
        {
          method: "DELETE",
          path: `${base}/:id`,
          description: "Delete by id.",
          params: { id: "Primary key" },
          requestBody: null,
          responseBody: null,
        },
      ],
    });
  }
  return { models };
}

/** @param {typeof import("../../core/model.js").Model} ModelClass @param {string} fieldName @param {string} raw */
export function coerceFilterValue(ModelClass, fieldName, raw) {
  const def = ModelClass.fields?.[fieldName];
  if (!def) return raw;
  if (def.primaryKey || def.type === "number" || def.type === "fk") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : raw;
  }
  return raw;
}

/**
 * @param {typeof import("../../core/model.js").Model} ModelClass
 * @returns {string[]}
 */
export function fkFieldNames(ModelClass) {
  return Object.entries(ModelClass.fields ?? {})
    .filter(([, d]) => d?.type === "fk")
    .map(([n]) => n);
}
