import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const { version } = JSON.parse(readFileSync(root("../package.json"), "utf-8")) as {
  version: string;
};

export default defineConfig({
  root: root("."),
  plugins: [react(), tailwindcss()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  resolve: { alias: { "@shared": root("../shared"), "@web": root("../web/src") } },
  // Tauri loads the page from a fixed address in development.
  server: { port: 1420, strictPort: true },
  clearScreen: false,
  build: { outDir: root("../dist/desktop"), emptyOutDir: true },
});
