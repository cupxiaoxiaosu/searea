import { normalizeFrontendBasePath } from "./koa/serve-frontend.js";

/**
 * 是否落在本套件托管范围：REST（`backendPath`）与管理端 SPA（`adminPath`），用于可选鉴权。
 * 与 `tryServeFrontendDist` / `createRestDispatch` 的前缀语义一致。
 */
export function isSeareaMountedPath(pathname, backendPath, adminPath) {
  const p =
    pathname.endsWith("/") && pathname.length > 1 ? pathname.slice(0, -1) : pathname;
  const bp = String(backendPath ?? "/api").replace(/\/$/, "");
  if (bp && (p === bp || p.startsWith(`${bp}/`))) return true;

  const adminBase = normalizeFrontendBasePath(adminPath);
  if (adminBase === "") {
    if (!bp) return true;
    return !(p === bp || p.startsWith(`${bp}/`));
  }
  return p === adminBase || p.startsWith(`${adminBase}/`);
}
