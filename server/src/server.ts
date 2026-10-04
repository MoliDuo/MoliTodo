import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { openDb } from "./db/client.js";

const config = loadConfig();
const app = buildApp({ config, db: openDb(config.DATABASE_PATH), logger: true });

// Finish the requests in flight, then leave, so a deploy does not drop them (standard 010, 10.6.7).
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    app.close().then(
      () => process.exit(0),
      () => process.exit(1)
    );
  });
}

await app.listen({ port: config.PORT, host: config.HOST });
