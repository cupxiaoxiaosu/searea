import fs from "node:fs";
import path from "node:path";

import { rewriteRootBuiltFrontendFile } from "../core/frontend-dist-rewrite.js";
import { normalizeFrontendBasePath } from "../koa/serve-frontend.js";

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Express：若适用则发送 SPA / 静态文件，返回是否已结束响应。
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {{ frontendPath: string, backendPath?: string, adminPath?: string, frontendBasePath?: string, extraScript?: string }} opts
 * @returns {Promise<boolean>}
 */
export function tryServeFrontendDistExpress(req, res, opts) {
  const { frontendPath, backendPath = "/api", extraScript } = opts;
  const base = normalizeFrontendBasePath(opts.adminPath ?? opts.frontendBasePath);
  const pathname = req.path;

  if (req.method !== "GET") {
    return Promise.resolve(false);
  }
  const pref = backendPath.replace(/\/$/, "") || "/__no_api__";
  const apiPrefixRe = new RegExp(`^${escapeRe(pref)}(\\/|$)`);
  if (apiPrefixRe.test(pathname)) {
    return Promise.resolve(false);
  }

  const root = path.resolve(frontendPath, "dist");
  if (!fs.existsSync(path.join(root, "index.html"))) {
    return Promise.resolve(false);
  }

  if (base) {
    if (pathname === base) {
      res.redirect(302, `${base}/`);
      return Promise.resolve(true);
    }
    if (!pathname.startsWith(`${base}/`)) {
      return Promise.resolve(false);
    }
  }

  let urlPath = base ? pathname.slice(base.length) || "/" : pathname;
  let rel = decodeURIComponent(urlPath.replace(/^\/+/, "")) || ".";
  if (rel.includes("..")) {
    res.status(403).end();
    return Promise.resolve(true);
  }

  const abs = path.join(root, rel);
  const fileToSend =
    fs.existsSync(abs) && fs.statSync(abs).isFile() ? abs : path.join(root, "index.html");

  const needsRewrite = Boolean(base) || (backendPath && backendPath !== "/api") || Boolean(extraScript);
  if (needsRewrite) {
    const ext = path.extname(fileToSend).toLowerCase();
    if (ext === ".html" || ext === ".js") {
      const raw = fs.readFileSync(fileToSend, "utf8");
      const body = rewriteRootBuiltFrontendFile(raw, base, fileToSend, extraScript, backendPath);
      if (ext === ".html") {
        res.type("html");
      } else {
        res.type("application/javascript");
      }
      res.send(body);
      return Promise.resolve(true);
    }
  }

  return new Promise((resolve, reject) => {
    res.sendFile(fileToSend, (err) => {
      if (err) {
        if (!res.headersSent) res.status(500).end();
        reject(err);
        return;
      }
      resolve(true);
    });
  });
}
