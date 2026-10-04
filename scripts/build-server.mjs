// Bundles the server and the migration entry into dist/. Dependencies stay external (node_modules),
// our own code, including shared/, is bundled.
import { build } from "esbuild";
import { cpSync, rmSync } from "node:fs";

rmSync("dist/server", { recursive: true, force: true });
await build({
  entryPoints: { server: "server/src/server.ts", migrate: "server/src/migrate.ts" },
  outdir: "dist/server",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  packages: "external",
  sourcemap: true,
  tsconfig: "tsconfig.json",
});
cpSync("server/migrations", "dist/server/migrations", { recursive: true });
