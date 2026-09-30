import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri owns the window; the dev server must not open a browser itself.
// Fixed port + strictPort so tauri.conf.json's devUrl always resolves.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  // Relative asset paths: the production bundle is served from Tauri's
  // custom protocol, where absolute /assets URLs do not resolve.
  base: "./",
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // Rust 编译产物由 cargo 独占写入：一旦被 Vite 监视，Windows 上会抛
      // EBUSY: resource busy or locked 并直接让 dev server 退出。
      // 后端工具目录与构建产物同理，无需参与前端热更新。
      ignored: ["**/src-tauri/**", "**/tools/**", "**/dist/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    target: "esnext",
    outDir: "dist",
  },
});
