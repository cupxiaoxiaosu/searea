import test from "node:test";
import assert from "node:assert/strict";

import {
  rewriteRootBuiltAssetJs,
  rewriteRootBuiltIndexHtml,
} from "../src/server-adapters/core/frontend-dist-rewrite.js";

test("rewriteRootBuiltIndexHtml prefixes /assets for custom adminPath", () => {
  const html =
    '<script src="/assets/app.js"></script><link href="/assets/app.css">';
  const out = rewriteRootBuiltIndexHtml(html, "/admin-site");
  assert.match(out, /src="\/admin-site\/assets\/app\.js"/);
  assert.match(out, /href="\/admin-site\/assets\/app\.css"/);
});

test("rewriteRootBuiltAssetJs sets vue-router base", () => {
  const js = 'mode:"history",base:"/",routes:[]';
  const out = rewriteRootBuiltAssetJs(js, "/admin-site");
  assert.equal(out, 'mode:"history",base:"/admin-site/",routes:[]');
});
