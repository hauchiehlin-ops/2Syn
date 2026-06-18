use_strict: true;
import { defineConfig } from "vite";

export default defineConfig({
  base: './',
  // 防止 Vite 混淆 Tauri 環境變數
  clearScreen: false,
  // Tauri 監聽的埠口
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"]
    }
  }
});
