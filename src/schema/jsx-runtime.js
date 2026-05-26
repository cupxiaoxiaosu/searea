import { createElement, Fragment } from "./runtime.js";

function normalizeChildren(children) {
  if (children === undefined || children === null || children === false) return [];
  return Array.isArray(children) ? children : [children];
}

/**
 * Automatic JSX runtime entry (`jsxImportSource` → `…/jsx-runtime`).
 * @param {unknown} type
 * @param {Record<string, unknown> | null} props
 * @param {unknown} _key
 */
export function jsx(type, props, _key) {
  const p = props ? { ...props } : {};
  const children = /** @type {unknown} */ (p.children);
  delete p.children;
  const ch = normalizeChildren(children);
  return createElement(type, p, ...ch);
}

export const jsxs = jsx;

export { Fragment };
