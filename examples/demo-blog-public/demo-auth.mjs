import { AsyncLocalStorage } from "node:async_hooks";

const KEY = "__searea_demo_blog_auth__";
if (!globalThis[KEY]) {
  globalThis[KEY] = new AsyncLocalStorage();
}

/** @type {import("node:async_hooks").AsyncLocalStorage<{ writerId: number | null }>} */
export const demoAuth = globalThis[KEY];
