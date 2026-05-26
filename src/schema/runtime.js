export const Fragment = Symbol.for("searea.schema.Fragment");

function flatten(input, out) {
  for (const x of input) {
    if (Array.isArray(x)) {
      flatten(x, out);
    } else if (x !== null && x !== undefined && x !== false) {
      out.push(x);
    }
  }
  return out;
}

/**
 * @param {string|Function|import("react").ElementType} type
 * @param {Record<string, unknown> | null} [props]
 * @param {unknown[]} children
 */
export function createElement(type, props, ...children) {
  const flat = flatten(children, []);
  if (typeof type === "function") {
    return type({ ...(props || {}), children: flat });
  }
  return { type, props: props || {}, children: flat };
}
