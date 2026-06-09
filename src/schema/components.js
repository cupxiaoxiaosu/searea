/** @type {("onPost"|"onGetList"|"onGetItem"|"onPatch"|"onDelete")[]} */
const KNOWN_TABLE_EVENTS = ["onPost", "onGetList", "onGetItem", "onPatch", "onDelete"];

const FUTURE_EVENT_PATTERN = /^(before|after|on)[A-Z]/;

/**
 * @param {Record<string, unknown>} props
 */
function extractTableEvents(tableName, props) {
  /** @type {Record<string, Function>} */
  const events = {};
  /** @type {string[]} */
  const unknown = [];

  const metaKeys = new Set(["name", "children", "admin", "modelName", "managers"]);
  for (const key of Object.keys(props)) {
    if (metaKeys.has(key)) continue;
    if (KNOWN_TABLE_EVENTS.includes(/** @type {KnownEvent} */ (key))) {
      const fn = props[key];
      if (typeof fn !== "function") {
        throw new Error(`<Table name="${tableName}">.${key} must be a function`);
      }
      events[key] = fn;
      continue;
    }
    if (FUTURE_EVENT_PATTERN.test(key)) {
      unknown.push(key);
    }
  }

  if (unknown.length > 0) {
    console.warn(
      `<Table name="${tableName}">: unknown event prop(s) ${unknown.join(", ")} — ignored (v1 only supports ${KNOWN_TABLE_EVENTS.join(", ")})`,
    );
  }

  return events;
}

/**
 * @param {string} fieldKind
 * @param {Record<string, unknown>} props
 */
function fieldNode(fieldKind, props) {
  const name = props.name;
  if (!name || typeof name !== "string") {
    throw new Error(`${fieldKind}: name is required`);
  }

  /** @type {Record<string, unknown>} */
  const out = { kind: "field", fieldKind, name };
  const lbRaw = props.label;
  if (typeof lbRaw === "string" && lbRaw.trim()) {
    out.label = lbRaw.trim();
  }
  if (props.null !== undefined) out.null = !!props.null;
  if ("defaultValue" in props) out.defaultValue = props.defaultValue;
  if (props.primaryKey) out.primaryKey = true;
  if (fieldKind === "char" && "maxLength" in props) out.maxLength = props.maxLength;
  if (typeof props.pattern === "string" && props.pattern.trim()) {
    out.pattern = props.pattern.trim();
  }
  if (typeof props.patternHint === "string" && props.patternHint.trim()) {
    out.patternHint = props.patternHint.trim();
  }
  if (Array.isArray(props.choices)) {
    out.choices = props.choices;
  }
  if (fieldKind === "foreignKey") {
    if (typeof props.relatedTable === "string" && props.relatedTable) {
      out.relatedTable = props.relatedTable;
    }
    if (typeof props.relatedModel === "function") {
      out.relatedModel = props.relatedModel;
    }
  }
  if (fieldKind === "manyToMany") {
    if (typeof props.relatedTable === "string" && props.relatedTable) {
      out.relatedTable = props.relatedTable;
    }
    if (typeof props.relatedModel === "function") {
      out.relatedModel = props.relatedModel;
    }
    if (typeof props.through === "function") {
      out.through = props.through;
    }
    if (typeof props.throughTable === "string" && props.throughTable) {
      out.throughTable = props.throughTable;
    }
  }
  return out;
}

export const CharField = (p) => fieldNode("char", p);
export const TextField = (p) => fieldNode("text", p);
export const IntegerField = (p) => fieldNode("integer", p);
export const BooleanField = (p) => fieldNode("boolean", p);
export const DateField = (p = {}) => fieldNode("date", { ...p, null: p.null ?? true });
export const DateTimeField = (p = {}) => fieldNode("datetime", { ...p, null: p.null ?? true });

/** @param {Record<string, unknown> & { name?: string, children?: unknown[] }} props */
export function ForeignKey(p) {
  const node = fieldNode("foreignKey", p);
  if (!node.relatedTable && !node.relatedModel) {
    throw new Error(`ForeignKey "${p.name}": relatedTable or relatedModel is required`);
  }
  return node;
}

export function ManyToManyField(p) {
  const node = fieldNode("manyToMany", p);
  if (!node.relatedTable && !node.relatedModel) {
    throw new Error(`ManyToManyField "${p.name}": relatedTable or relatedModel is required`);
  }
  return node;
}

/**
 * @param {Record<string, unknown> & { name?: string, children?: unknown[] }} props
 */
export function Table(props) {
  const name = props.name;
  if (!name || typeof name !== "string") {
    throw new Error("<Table>: name is required");
  }

  const rawChildren = props.children ?? [];
  const arr = Array.isArray(rawChildren) ? rawChildren : [rawChildren];
  const fields = arr.filter((c) => c && typeof c === "object" && /** @type {{kind?: string}} */ (c).kind === "field");

  const events = extractTableEvents(name, props);

  const modelName =
    typeof props.modelName === "string" && props.modelName ? props.modelName : undefined;
  const admin =
    props.admin && typeof props.admin === "object" && !Array.isArray(props.admin)
      ? { ...props.admin }
      : undefined;

  /** @type {Record<string, Function> | undefined} */
  let managers;
  if (props.managers != null) {
    if (typeof props.managers !== "object" || Array.isArray(props.managers)) {
      throw new Error(`<Table name="${name}">: managers must be a plain object of Manager classes`);
    }
    managers = { ...props.managers };
    for (const [k, Ctor] of Object.entries(managers)) {
      if (typeof k !== "string" || !k.length) {
        throw new Error(`<Table name="${name}">: invalid manager key`);
      }
      if (typeof Ctor !== "function") {
        throw new Error(`<Table name="${name}">: managers.${k} must be a class constructor`);
      }
    }
  }

  return { kind: "table", name, modelName, admin, fields, events, managers };
}

/**
 * @param {{ children?: unknown[] }} props
 */
export function Database(props) {
  const raw = props.children ?? [];
  const arr = Array.isArray(raw) ? raw : [raw];
  const tables = arr.filter((c) => c && typeof c === "object" && /** @type {{kind?: string}} */ (c).kind === "table");
  return { kind: "database", tables };
}
