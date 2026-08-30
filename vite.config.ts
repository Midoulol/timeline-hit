import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Webview build. The renderer talks to the main process over plain fetch to the
// local HTTP server, so it does not import `electrobun/*` and needs no devkit
// alias. When the Hutch devkit is projected, the project's tsconfig should
// switch to extending `.hutch/devkit/tsconfig.json`.
export default defineConfig({
  root: "src/mainview",
  base: "./",
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  build: {
    outDir: "../../dist/mainview",
    emptyOutDir: true,
  },
});
