/** 与 Koa `createKoaRestMiddleware({ backendPath })`、Vite proxy 保持一致 */
export const BACKEND_PATH = import.meta.env.VITE_BACKEND_PATH || "/api";

export function apiUrl(path) {
  const [pathname, query] = String(path).split("?");
  const p = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const base = `${BACKEND_PATH}${p}`;
  return query ? `${base}?${query}` : base;
}
