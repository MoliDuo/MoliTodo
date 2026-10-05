import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const root = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const { version } = JSON.parse(readFileSync(root("../package.json"), "utf-8")) as {
  version: string;
};

export default defineConfig({
  root: root("."),
  plugins: [
    react(),
    tailwindcss(),
    // The app shell (scripts, styles, icons, covers, the page) is kept on the device, so the app opens without
    // waiting for the network; the data lives in IndexedDB (web/src/lib/local-cache.ts). The manifest stays the
    // hand-written one in public/.
    VitePWA({
      registerType: "prompt",
      injectRegister: false,
      manifest: false,
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,webp,webmanifest}"],
        navigateFallback: "/index.html",
        // Sign-in and the API always go to the server.
        navigateFallbackDenylist: [/^\/api\//, /^\/auth\//, /^\/healthz/],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  define: { __APP_VERSION__: JSON.stringify(version) },
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
