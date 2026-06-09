/** @typedef {{ field: string, code: string, message: string }} ValidationDetail */

export class FieldValidationError extends Error {
  /** @param {ValidationDetail[]} details */
  constructor(details) {
    super("validation_failed");
    this.name = "FieldValidationError";
    /** @type {ValidationDetail[]} */
    this.details = details;
  }
}

/**
 * @param {object} def
 * @param {unknown} v
 */
function shouldSkipNullableSemantics(def, v) {
  if (v === null || v === undefined) return true;
  if (def.null && v === "") return true;
  return false;
}

/**
 * REST / PATCH: only validate keys present in `attrs`.
 *
 * @param {typeof import("./model.js").Model} modelClass
 * @param {Record<string, unknown>} attrs
 */
export function validateWriteAttrs(modelClass, attrs) {
  const fields = modelClass.fields ?? {};
  /** @type {ValidationDetail[]} */
  const details = [];

  for (const [key, raw] of Object.entries(attrs ?? {})) {
    const def = fields[key];
    if (!def) continue;

    if (shouldSkipNullableSemantics(def, raw)) {
      if (raw === "" && !def.null) {
        if (def._choiceSet) {
          if (!def._choiceSet.has("")) {
            details.push({
              field: key,
              code: "invalid_choice",
              message: "Value is not an allowed choice.",
            });
          }
        }
        if (def._compiledPattern && (def.type === "char" || def.type === "text")) {
          if (!def._compiledPattern.test("")) {
            details.push({
              field: key,
              code: "pattern_mismatch",
              message: "Value does not match the required pattern.",
            });
          }
        }
      }
      continue;
    }

    const v = raw;

    if (def.type === "m2m") {
      const arr = Array.isArray(v) ? v : [v];
      for (const item of arr) {
        const id = item && typeof item === "object" ? item.id : item;
        if (typeof id !== "number" || !Number.isFinite(id)) {
          details.push({
            field: key,
            code: "invalid_relation",
            message: "Value must be a related id or an array of related ids.",
          });
          break;
        }
      }
      continue;
    }

    if (def._choiceSet) {
      let inSet = false;
      if (def.type === "number") {
        if (typeof v !== "number" || !Number.isFinite(v)) {
          details.push({
            field: key,
            code: "invalid_choice",
            message: "Value must be a finite number.",
          });
        } else if (!def._choiceSet.has(v)) {
          details.push({
            field: key,
            code: "invalid_choice",
            message: "Value is not an allowed choice.",
          });
        } else {
          inSet = true;
        }
      } else if (def.type === "char" || def.type === "text") {
        if (typeof v !== "string") {
          details.push({
            field: key,
            code: "invalid_choice",
            message: "Value must be a string.",
          });
        } else if (!def._choiceSet.has(v)) {
          details.push({
            field: key,
            code: "invalid_choice",
            message: "Value is not an allowed choice.",
          });
        } else {
          inSet = true;
        }
      }

      if (inSet && def._compiledPattern && (def.type === "char" || def.type === "text")) {
        if (typeof v === "string" && !def._compiledPattern.test(v)) {
          details.push({
            field: key,
            code: "pattern_mismatch",
            message: "Value does not match the required pattern.",
          });
        }
      }
      continue;
    }

    if (def._compiledPattern && (def.type === "char" || def.type === "text")) {
      if (typeof v !== "string") {
        details.push({
          field: key,
          code: "invalid_choice",
          message: "Value must be a string.",
        });
      } else if (!def._compiledPattern.test(v)) {
        details.push({
          field: key,
          code: "pattern_mismatch",
          message: "Value does not match the required pattern.",
        });
      }
    }
  }

  if (details.length) {
    throw new FieldValidationError(details);
  }
}

/**
 * List filters: for fields with `choices`, query value must be in the set (`pattern` does not apply).
 *
 * @param {typeof import("./model.js").Model} modelClass
 * @param {Record<string, unknown>} where
 */
export function validateFilterWhere(modelClass, where) {
  const fields = modelClass.fields ?? {};
  /** @type {ValidationDetail[]} */
  const details = [];

  for (const [key, val] of Object.entries(where ?? {})) {
    const def = fields[key];
    if (!def?._choiceSet) continue;
    if (val === null || val === undefined) continue;
    if (!def._choiceSet.has(val)) {
      details.push({
        field: key,
        code: "invalid_choice",
        message: "Filter value is not an allowed choice.",
      });
    }
  }

  if (details.length) {
    throw new FieldValidationError(details);
  }
}
