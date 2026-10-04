import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const root = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const alias = {
  "@shared": root("./shared"),
  "@server": root("./server/src"),
  "@web": root("./web/src"),
};

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "node",
          include: ["server/**/*.test.ts", "shared/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        resolve: { alias },
        define: { __APP_VERSION__: JSON.stringify("0.0.0-test") },
        test: {
          name: "web",
          include: ["web/**/*.test.{ts,tsx}"],
          environment: "jsdom",
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["server/src/**", "shared/**", "web/src/**"],
      exclude: [
        "**/*.test.*",
        "**/test-support/**",
        "**/test-support.ts",
        "server/src/server.ts",
        "server/src/migrate.ts",
        "web/src/main.tsx",
      ],
      // The floor only goes up (standard 004, 4.4.2): raise it when coverage rises.
      thresholds: { lines: 98, functions: 98, branches: 95, statements: 98 },
    },
  },
});
