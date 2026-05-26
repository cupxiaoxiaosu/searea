/**
 * @param {object} target — concrete model class (`this` in Model.init)
 * @returns {Record<string, function>} managers to instantiate; `{}` if omitted / invalid shape
 */
export function validateModelInitConfig(target, { db, table, managers, admin } = {}) {
  if (!db) {
    throw new Error("No db configured. Call Model.useDB(db) first or pass db in init().");
  }
  if (!table) {
    throw new Error("No table configured. Pass { table } to init().");
  }
  validateFields(target.fields ?? {});
  if (admin != null && (typeof admin !== "object" || Array.isArray(admin))) {
    throw new Error("init admin must be a plain object");
  }
  if (!managers || typeof managers !== "object") {
    return {};
  }

  for (const [name, ManagerClass] of Object.entries(managers)) {
    if (!name || typeof name !== "string") {
      throw new Error("Invalid manager name");
    }
    if (name === "objects") {
      throw new Error('Manager name "objects" is reserved');
    }
    if (target[name] !== undefined) {
      throw new Error(`Manager name conflicts with existing property: ${name}`);
    }
    if (typeof ManagerClass !== "function") {
      throw new Error(`Manager "${name}" must be a class constructor`);
    }
  }

  return managers;
}

/**
 * @param {string} fieldName
 * @param {object} def
 */
function compilePatternAndChoices(fieldName, def) {
  delete def._compiledPattern;
  delete def._choiceSet;

  const type = def.type;
  const hasChoices = def.choices !== undefined && def.choices !== null;
  const patternRaw = def.pattern;
  const hasPattern =
    patternRaw !== undefined && patternRaw !== null && !(typeof patternRaw === "string" && patternRaw === "");

  if (hasPattern && type !== "char" && type !== "text") {
    throw new Error(`Field "${fieldName}": pattern is only allowed on char or text fields`);
  }
  if (hasChoices && type !== "char" && type !== "text" && type !== "number") {
    throw new Error(`Field "${fieldName}": choices are only allowed on char, text, or number fields`);
  }

  if (type === "char" || type === "text") {
    if (hasPattern) {
      if (typeof def.pattern !== "string") {
        throw new Error(`Field "${fieldName}": pattern must be a string`);
      }
      try {
        def._compiledPattern = new RegExp(def.pattern);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`Field "${fieldName}": invalid pattern (${msg})`);
      }
    }

    if (hasChoices) {
      if (!Array.isArray(def.choices)) {
        throw new Error(`Field "${fieldName}": choices must be an array`);
      }
      const seen = new Set();
      const normalized = [];
      for (let i = 0; i < def.choices.length; i++) {
        const item = def.choices[i];
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          throw new Error(`Field "${fieldName}": choices[${i}] must be an object`);
        }
        const val = item.value;
        const label = item.label;
        if (typeof val !== "string" || val.length === 0) {
          throw new Error(`Field "${fieldName}": choices[${i}].value must be a non-empty string`);
        }
        if (typeof label !== "string" || !label.trim()) {
          throw new Error(`Field "${fieldName}": choices[${i}].label must be a non-empty string`);
        }
        if (seen.has(val)) {
          throw new Error(`Field "${fieldName}": duplicate choice value "${val}"`);
        }
        seen.add(val);
        normalized.push({ value: val, label: label.trim() });
      }
      def.choices = normalized;
      def._choiceSet = seen;

      if (def._compiledPattern) {
        for (const v of seen) {
          if (!def._compiledPattern.test(v)) {
            throw new Error(`Field "${fieldName}": choice value "${v}" does not match pattern`);
          }
        }
      }
    }
  }

  if (type === "number" && hasChoices) {
    if (!Array.isArray(def.choices)) {
      throw new Error(`Field "${fieldName}": choices must be an array`);
    }
    const seen = new Set();
    const normalized = [];
    for (let i = 0; i < def.choices.length; i++) {
      const item = def.choices[i];
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new Error(`Field "${fieldName}": choices[${i}] must be an object`);
      }
      const val = item.value;
      const label = item.label;
      if (typeof val !== "number" || !Number.isFinite(val)) {
        throw new Error(`Field "${fieldName}": choices[${i}].value must be a finite number`);
      }
      if (typeof label !== "string" || !label.trim()) {
        throw new Error(`Field "${fieldName}": choices[${i}].label must be a non-empty string`);
      }
      if (seen.has(val)) {
        throw new Error(`Field "${fieldName}": duplicate choice value ${val}`);
      }
      seen.add(val);
      normalized.push({ value: val, label: label.trim() });
    }
    def.choices = normalized;
    def._choiceSet = seen;
  }
}

/** @type {readonly ("onPost"|"onGetList"|"onGetItem"|"onPatch"|"onDelete")[]} */
export const KNOWN_REST_EVENT_NAMES = [
  "onPost",
  "onGetList",
  "onGetItem",
  "onPatch",
  "onDelete",
];

const KNOWN_REST_EVENT_SET = new Set(KNOWN_REST_EVENT_NAMES);

/**
 * @param {unknown} raw
 * @param {string} [label]
 * @returns {Record<string, Function>}
 */
export function validateRestEvents(raw, label = "events") {
  if (raw == null || raw === undefined) {
    return {};
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${label} must be a plain object`);
  }
  /** @type {Record<string, Function>} */
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!KNOWN_REST_EVENT_SET.has(/** @type {any} */ (k))) {
      throw new Error(`${label}: unknown key "${k}" (supported: ${KNOWN_REST_EVENT_NAMES.join(", ")})`);
    }
    if (typeof v !== "function") {
      throw new Error(`${label}.${k} must be a function`);
    }
    out[k] = v;
  }
  return out;
}

function validateFields(fields) {
  const allowedTypes = new Set(["number", "fk", "char", "text", "date", "datetime"]);

  for (const [name, def] of Object.entries(fields)) {
    const type = def?.type;
    if (!allowedTypes.has(type)) {
      throw new Error(
        `Field "${name}" has invalid type "${type}". Use "char" or "text" instead of "string".`
      );
    }
    if (type === "char") {
      const maxLength = def?.max_length;
      if (typeof maxLength !== "number" || !Number.isFinite(maxLength) || maxLength <= 0) {
        throw new Error(`Field "${name}" with type "char" requires a positive max_length`);
      }
    }
    compilePatternAndChoices(name, def);
  }
}
