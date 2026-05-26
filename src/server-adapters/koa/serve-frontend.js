import fs from "node:fs";
import path from "node:path";
import send from "koa-send";

import { rewriteRootBuiltFrontendFile } from "../core/frontend-dist-rewrite.js";

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** @param {string} [bp] */
export function normalizeFrontendBasePath(bp) {
  if (bp == null || bp === "" || bp === "/") return "";
  const s = String(bp).trim();
  const withSlash = s.startsWith("/") ? s : `/${s}`;
  return withSlash.replace(/\/$/, "");
}

/**
 * 若适用则响应 SPA / 静态文件，返回是否已写出响应。
 * @param {import('koa').Context} ctx
 * @param {{
 *   frontendPath: string,
 *   backendPath?: string,
 *   adminPath?: string,
 *   frontendBasePath?: string,
 *   extraScript?: string,
 * }} opts — **`adminPath`**（或兼容旧字段 **`frontendBasePath`**）无前导斜杠亦可；空或未设置表示挂在站点根路径（除 API 外）
 * @returns {Promise<boolean>}
 */
export async function tryServeFrontendDist(ctx, opts) {
  const { frontendPath, backendPath = "/api", extraScript } = opts;
  const base = normalizeFrontendBasePath(opts.adminPath ?? opts.frontendBasePath);

  if (ctx.method !== "GET") {
    return false;
  }
  const pref = backendPath.replace(/\/$/, "") || "/__no_api__";
  const apiPrefixRe = new RegExp(`^${escapeRe(pref)}(\\/|$)`);
  if (apiPrefixRe.test(ctx.path)) {
    return false;
  }
  const root = path.resolve(frontendPath, "dist");
  if (!fs.existsSync(path.join(root, "index.html"))) {
    return false;
  }

  let urlPath = ctx.path;
  if (base) {
    if (ctx.path === base) {
      ctx.status = 302;
      ctx.redirect(`${base}/`);
      return true;
    }
    if (!ctx.path.startsWith(`${base}/`)) {
      return false;
    }
    urlPath = ctx.path.slice(base.length) || "/";
  }

  let rel = decodeURIComponent(urlPath.replace(/^\/+/, "")) || ".";
  if (rel.includes("..")) {
    ctx.status = 403;
    return true;
  }
  const abs = path.join(root, rel);
  let filePath = rel;
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    filePath = "index.html";
  }

  if (base) {
    const absSend = path.join(root, filePath);
    const ext = path.extname(absSend).toLowerCase();
    if (ext === ".html" || ext === ".js") {
      const raw = fs.readFileSync(absSend, "utf8");
      ctx.type = ext === ".html" ? "html" : "application/javascript";
      ctx.body = rewriteRootBuiltFrontendFile(raw, base, absSend, extraScript);
      return true;
    }
  } else if (extraScript && filePath === "index.html") {
    const absSend = path.join(root, filePath);
    const raw = fs.readFileSync(absSend, "utf8");
    ctx.type = "html";
    ctx.body = rewriteRootBuiltFrontendFile(raw, "", absSend, extraScript);
    return true;
  }

  await send(ctx, filePath, { root, maxage: 0 });
  return true;
}

/**
 * 单独挂载：仅托管 `frontendPath/dist`（REST 需挂在本中间件之前）。
 * @param {{ frontendPath: string, backendPath?: string, adminPath?: string, frontendBasePath?: string }} opts
 */
export function createServeFrontendDistMiddleware(opts) {
  return async function serveFrontendDist(ctx, next) {
    if (await tryServeFrontendDist(ctx, opts)) {
      return;
    }
    return next();
  };
}
