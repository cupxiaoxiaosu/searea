import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const MIME = {
  ".html": "text/html;charset=utf-8",
  ".css": "text/css;charset=utf-8",
  ".js": "application/javascript;charset=utf-8",
  ".svg": "image/svg+xml",
};

function bearerToken(headers) {
  const raw = headers?.authorization ?? headers?.Authorization ?? "";
  const m = /^Bearer\s+(\S+)/i.exec(String(raw));
  return m ? m[1] : null;
}

/** Demo auth: login 返回随机 jwtToken，服务端用内存 Map 校验。 */
export function createDemoJwtAuth() {
  /** @type {Map<string, Record<string, number>>} */
  const jwtTokenMap = new Map();

  function getUserId(ctx, sessionField) {
    const jwtToken = bearerToken(ctx.headers);
    if (!jwtToken) return null;
    return jwtTokenMap.get(jwtToken)?.[sessionField] ?? null;
  }

  function revokeToken(ctx) {
    const jwtToken = bearerToken(ctx.headers);
    if (jwtToken) jwtTokenMap.delete(jwtToken);
  }

  return { jwtTokenMap, getUserId, revokeToken };
}

/**
 * Auth routes (`/api/auth/*`) + static `public/` after REST middleware.
 */
export function createDemoTailMiddleware({ backendPath, publicDir, auth, extraScript }) {
  const { jwtTokenMap, getUserId, revokeToken, userModel, sessionField, profileKey } =
    auth;
  const authBase = `${backendPath}/auth`;

  return async function demoTail(ctx) {
    if (ctx.path === `${authBase}/login` && ctx.method === "POST") {
      const body =
        typeof ctx.request.body === "object" && ctx.request.body !== null
          ? ctx.request.body
          : {};
      const username = String(body.username ?? "").trim();
      const password = String(body.password ?? "");
      if (!username || !password) {
        ctx.status = 400;
        ctx.body = { error: "username_and_password_required" };
        return;
      }
      let user = null;
      try {
        user = await userModel.objects.filter({ username }).first();
      } catch {
        user = null;
      }
      if (!user || user.password_plain !== password) {
        ctx.status = 401;
        ctx.body = { error: "invalid_credentials" };
        return;
      }
      const jwtToken = crypto.randomBytes(24).toString("hex");
      jwtTokenMap.set(jwtToken, { [sessionField]: user.id });
      ctx.body = {
        jwtToken,
        [profileKey]: {
          id: user.id,
          username: user.username,
          display_name: user.display_name,
        },
      };
      return;
    }

    if (ctx.path === `${authBase}/logout` && ctx.method === "POST") {
      revokeToken(ctx);
      ctx.body = { ok: true };
      return;
    }

    if (ctx.path === `${authBase}/me` && ctx.method === "GET") {
      const uid = getUserId(ctx, sessionField);
      if (!uid) {
        ctx.status = 401;
        ctx.body = { error: "not_logged_in" };
        return;
      }
      try {
        const u = await userModel.objects.get({ id: uid });
        ctx.body = await userModel.serialize(u, { fkDepth: 0 });
      } catch {
        ctx.status = 401;
        ctx.body = { error: "invalid_session" };
      }
      return;
    }

    if (ctx.path.startsWith(backendPath)) {
      ctx.status = 404;
      ctx.body = { error: "Not found" };
      return;
    }

    try {
      const rel = ctx.path === "/" ? "index.html" : ctx.path.replace(/^\//, "");
      const safe = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, "");
      const full = path.join(publicDir, safe);
      if (!full.startsWith(publicDir)) {
        ctx.status = 403;
        return;
      }
      const stat = await fs.stat(full);
      const file = stat.isDirectory() ? path.join(full, "index.html") : full;
      const ext = path.extname(file).toLowerCase();
      ctx.type = MIME[ext] ?? "application/octet-stream";
      let content = await fs.readFile(file);
      if (extraScript && ext === ".html") {
        content = content.toString().replace("</body>", `${extraScript}</body>`);
      }
      ctx.body = content;
    } catch {
      ctx.status = 404;
      ctx.body = "Not found";
    }
  };
}
