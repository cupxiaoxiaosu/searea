import path from "node:path";
import { defineConfig, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue2";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const proxyTarget = env.VITE_PROXY_TARGET || "http://127.0.0.1:3456";
  const siteBaseRaw = env.VITE_FRONTEND_BASE || "/";
  const base = siteBaseRaw.endsWith("/") ? siteBaseRaw : `${siteBaseRaw}/`;

  return {
    base,
    plugins: [vue()],
    resolve: {
      alias: {
        vue: "vue/dist/vue.esm.js",
        "@": path.resolve(__dirname, "src"),
      },
    },
    server: {
      port: Number(env.VITE_PORT) || 5173,
      proxy: {
        [env.VITE_BACKEND_PATH || "/api"]: {
          target: proxyTarget,
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: "dist",
      sourcemap: false,
    },
  };
});
