/**
 * Vite 默认 `base: "/"` 时，静态资源在 `/assets/*`，路由 `base` 为 `"/"`。
 * 当 Admin 挂在自定义 `adminPath` 下时，对返回的 index.html / 主 bundle 做运行时改写。
 */

/** @param {string} adminPath */
export function normalizeAdminPrefix(adminPath) {
  if (adminPath == null || adminPath === "" || adminPath === "/") return "";
  const s = String(adminPath).trim();
  const withSlash = s.startsWith("/") ? s : `/${s}`;
  return withSlash.replace(/\/$/, "");
}

/**
 * @param {string} html
 * @param {string} adminPath
 * @param {string} [extraScript] — injected before </body> when serving index.html
 */
export function rewriteRootBuiltIndexHtml(html, adminPath, extraScript) {
  const prefix = normalizeAdminPrefix(adminPath);
  let result = prefix
    ? html.replace(/(\s(?:src|href)=["'])\/assets\//g, `$1${prefix}/assets/`)
    : html;
  if (extraScript) {
    result = result.replace("</body>", `${extraScript}</body>`);
  }
  return result;
}

/**
 * @param {string} js
 * @param {string} adminPath
 * @param {string} [backendPath] - 当与构建时默认值 "/api" 不同时，运行时改写 JS 中的 API 前缀
 */
export function rewriteRootBuiltAssetJs(js, adminPath, backendPath) {
  const prefix = normalizeAdminPrefix(adminPath);
  let result = js;
  if (prefix) {
    const base = `${prefix}/`;
    result = result.replace(/base:"\/"/g, `base:"${base}"`).replace(/base:'\/'/g, `base:'${base}'`);
  }
  // 运行时改写 API 前缀（构建时默认 "/api"）
  if (backendPath && backendPath !== "/api") {
    result = result.replace(/="\/api"/g, `="${backendPath}"`);
  }
  return result;
}

/**
 * @param {string} content
 * @param {string} adminPath
 * @param {string} filePath absolute or relative path for kind detection
 * @param {string} [extraScript] — injected before </body> when serving index.html
 * @param {string} [backendPath] — runtime rewrite API prefix in JS
 */
export function rewriteRootBuiltFrontendFile(content, adminPath, filePath, extraScript, backendPath) {
  const name = String(filePath).replace(/\\/g, "/");
  if (name.endsWith("/index.html") || name.endsWith("index.html")) {
    return rewriteRootBuiltIndexHtml(content, adminPath, extraScript);
  }
  if (/\/assets\/.*\.js$/i.test(name)) {
    return rewriteRootBuiltAssetJs(content, adminPath, backendPath);
  }
  return content;
}
