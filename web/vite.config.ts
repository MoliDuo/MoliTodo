import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  root: root("."),
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@shared": root("../shared") } },
  build: { outDir: root("../dist/web"), emptyOutDir: true },
  server: {
    // In development the server runs on its own port; the browser talks to Vite only.
    proxy: {
      "/api": "http://127.0.0.1:3000",
      "/auth": "http://127.0.0.1:3000",
      "/healthz": "http://127.0.0.1:3000",
    },
  },
});
