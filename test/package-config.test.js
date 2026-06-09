import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("package publishes the built admin frontend", () => {
  assert.ok(
    pkg.files.includes("src/frontend/dist"),
    "published package must include the prebuilt admin frontend"
  );
  assert.match(
    pkg.scripts.prepack ?? "",
    /frontend:build/,
    "npm pack/publish should build the admin frontend before packaging"
  );
});

test("demo scripts point to existing entry files", () => {
  for (const [name, script] of Object.entries(pkg.scripts)) {
    if (!name.startsWith("example:demo:")) continue;

    const entry = script.match(/node(?: --import \S+)? (?<file>\S+\.mjs)/)?.groups?.file;
    assert.ok(entry, `${name} should start a .mjs entry with node`);
    assert.ok(fs.existsSync(new URL(`../${entry}`, import.meta.url)), `${name} entry exists`);
  }
});
