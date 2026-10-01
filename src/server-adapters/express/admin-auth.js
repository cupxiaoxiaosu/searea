import crypto from "node:crypto";

/**
 * 后台管理登录页 HTML
 */
function buildLoginPageHtml(loginPath, adminPath) {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>后台管理登录</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, sans-serif; background: #f0f2f5; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
  .card { background: #fff; border-radius: 12px; padding: 40px; width: 360px; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
  h1 { font-size: 22px; color: #171717; margin-bottom: 28px; text-align: center; }
  input { width: 100%; height: 44px; border: 1px solid #ddd; border-radius: 8px; padding: 0 16px; font-size: 15px; margin-bottom: 16px; outline: none; transition: border-color .2s; }
  input:focus { border-color: #003D82; }
  button { width: 100%; height: 44px; background: #003D82; color: #fff; border: none; border-radius: 8px; font-size: 16px; cursor: pointer; }
  button:hover { background: #0056B3; }
  .err { color: #e8463a; font-size: 14px; text-align: center; margin-bottom: 12px; display: none; }
</style>
</head>
<body>
<div class="card">
  <h1>后台管理</h1>
  <div class="err" id="err"></div>
  <input id="username" placeholder="用户名" autocomplete="username">
  <input id="password" type="password" placeholder="密码" autocomplete="current-password">
  <button id="btn" onclick="doLogin()">登录</button>
</div>
<script>
  function doLogin() {
    var u = document.getElementById('username').value;
    var p = document.getElementById('password').value;
    var err = document.getElementById('err');
    var btn = document.getElementById('btn');
    btn.disabled = true; btn.textContent = '登录中...'; err.style.display = 'none';
    fetch('${loginPath}', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.token) {
          document.cookie = 'admin_token=' + d.token + ';path=/;max-age=604800';
          location.href = '${adminPath}';
        } else {
          err.textContent = d.msg || '登录失败'; err.style.display = 'block';
          btn.disabled = false; btn.textContent = '登录';
        }
      })
      .catch(function() { err.textContent = '网络错误'; err.style.display = 'block'; btn.disabled = false; btn.textContent = '登录'; });
  }
  document.getElementById('password').addEventListener('keydown', function(e) { if (e.key === 'Enter') doLogin(); });
</script>
</body>
</html>`;
}

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function signToken(secret, expiresIn) {
  const payload = {
    type: "admin",
    iat: Date.now(),
    exp: Date.now() + expiresIn * 1000,
  };
  const payloadB64 = base64url(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", secret).update(payloadB64).digest("base64url");
  return `${payloadB64}.${sig}`;
}

function verifyToken(secret, token) {
  if (!token || typeof token !== "string") return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [payloadB64, sig] = parts;
  const expectedSig = crypto.createHmac("sha256", secret).update(payloadB64).digest("base64url");
  if (sig !== expectedSig) return false;
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    if (payload.type !== "admin") return false;
    if (typeof payload.exp === "number" && Date.now() > payload.exp) return false;
    return true;
  } catch {
    return false;
  }
}

function extractToken(req, cookieName) {
  const cookie = req.headers.cookie || "";
  const m = cookie.match(new RegExp(`${cookieName}=([^;]+)`));
  if (m) return m[1];
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  return null;
}

function readBodyRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/**
 * 创建后台管理鉴权（登录页 + 登录接口 + authorize 闸门）
 *
 * @param {object} config
 * @param {string} config.username - 管理员用户名
 * @param {string} config.password - 管理员密码
 * @param {string} config.secret - 签名密钥
 * @param {number} [config.expiresIn=604800] - token 有效期（秒），默认 7 天
 * @param {string} [config.loginPath='/admin/login'] - 登录页路径
 * @param {string} [config.adminPath='/model-site'] - 管理端 SPA 路径（登录成功后跳转）
 * @param {string[]} [config.excludePrefixes=[]] - 需要跳过鉴权的路径前缀（如业务路由 ['/api/biz']）
 * @param {string} [config.cookieName='admin_token'] - cookie 名称
 * @returns {{ authorize: Function, handleLoginRoute: Function, loginPath: string }}
 */
export function createAdminAuth(config = {}) {
  const {
    username,
    password,
    secret,
    expiresIn = 7 * 24 * 60 * 60,
    loginPath = "/admin/login",
    adminPath = "/model-site",
    excludePrefixes = [],
    cookieName = "admin_token",
  } = config;

  if (!username || !password || !secret) {
    throw new Error("createAdminAuth: username, password, secret are required");
  }

  const loginPageHtml = buildLoginPageHtml(loginPath, adminPath);

  function authorize(req, res, next) {
    const url = req.url || req.path || "";
    for (const prefix of excludePrefixes) {
      if (url.startsWith(prefix)) return next();
    }

    const token = extractToken(req, cookieName);
    if (token && verifyToken(secret, token)) {
      return next();
    }

    const accept = req.headers.accept || "";
    if (accept.includes("text/html")) {
      res.writeHead(302, { Location: loginPath });
      res.end();
      return;
    }
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ code: 401, msg: "未登录" }));
  }

  async function handleLoginRoute(req, res) {
    if (req.method === "GET") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(loginPageHtml);
      return true;
    }

    if (req.method === "POST") {
      const raw = await readBodyRaw(req);
      let body = {};
      try { body = JSON.parse(raw || "{}"); } catch { /* empty */ }

      const { username: u, password: p } = body;
      if (u !== username || p !== password) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ code: 1, msg: "用户名或密码错误" }));
        return true;
      }

      const token = signToken(secret, expiresIn);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ token }));
      return true;
    }

    return false;
  }

  return { authorize, handleLoginRoute, loginPath };
}
