import { BACKEND_PATH } from "../config.js";

/** Admin JSON API 前缀：与 Koa `backendPath` 一致（不同于 SPA 的 `BASE_URL`）。 */
export function getAdminApiBase() {
  const b = (BACKEND_PATH || "/api").replace(/\/+$/, "");
  return b.length ? b : "/api";
}

/**
 * 拼 Admin JSON 路径，如 `adminApiUrl("schools", "meta")` → `/api/schools/meta`。
 */
export function adminApiUrl(...pathSegments) {
  const base = getAdminApiBase();
  const path = pathSegments
    .map((s) => String(s).replace(/^\/+|\/+$/g, ""))
    .filter((s) => s.length > 0)
    .join("/");
  if (!path) {
    return base || "/";
  }
  if (base === "" || base === "/") {
    return `/${path}`.replace(/\/+/g, "/");
  }
  return `${base}/${path}`.replace(/\/+/g, "/");
}

export function requestJson(url, options) {
  return fetch(url, options).then((response) => {
    if (!response.ok) {
      return response.text().then((body) => {
        throw new Error(`Request failed (${response.status}): ${body}`);
      });
    }
    if (response.status === 204) {
      return null;
    }
    return response.json().then((payload) => {
      if (typeof window !== "undefined" && window.__searea_formatResponse) {
        if (payload && typeof payload === "object" && !Array.isArray(payload) && "data" in payload) {
          return payload.data;
        }
      }
      return payload;
    });
  });
}
