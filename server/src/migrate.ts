import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { openDb } from "./db/client.js";

// The deploy runs this from the same image before switching over (standard 005, 5.7).
const here = dirname(fileURLToPath(import.meta.url));
const config = loadConfig();
const db = openDb(config.DATABASE_PATH);
// Bundled in dist/ the migrations sit next to this file; from source they are one level up.
const bundled = join(here, "migrations");
migrate(db, { migrationsFolder: existsSync(bundled) ? bundled : join(here, "../migrations") });
console.log("migrations applied");
