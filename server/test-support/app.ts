import type { FastifyInstance } from "fastify";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { buildApp } from "../src/app.js";
import type { Config } from "../src/config.js";
import { openDb } from "../src/db/client.js";
import { createFakeIssuer, ISSUER, WEB_CLIENT, WEB_SECRET } from "./fake-issuer.js";

export const APP_URL = "https://todo.example.com";

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    APP_URL,
    OIDC_ISSUER: ISSUER,
    OIDC_CLIENT_ID: WEB_CLIENT,
    OIDC_CLIENT_SECRET: WEB_SECRET,
    DATABASE_PATH: ":memory:",
    PORT: 3000,
    HOST: "127.0.0.1",
    APP_VERSION: "test-version",
    SESSION_DAYS: 30,
    WEB_DIST: "./does-not-exist",
    ...overrides,
  };
}

export async function createTestApp(
  config: Partial<Config> = {},
  extend?: (app: FastifyInstance) => void
) {
  const clock = { now: Date.parse("2026-10-04T12:00:00Z") };
  const issuer = await createFakeIssuer(clock);
  const db = openDb(":memory:");
  migrate(db, { migrationsFolder: "server/migrations" });
  const app = buildApp({
    config: testConfig(config),
    db,
    fetch: issuer.fetch,
    now: () => clock.now,
    ...(extend ? { extend } : {}),
  });
  await app.ready();

  /** Runs the whole browser sign-in; returns the session cookie value, or the failing response. */
  async function signIn(username = "alice", next?: string) {
    const start = await app.inject({
      method: "GET",
      url: next ? `/auth/login?next=${encodeURIComponent(next)}` : "/auth/login",
    });
    const loginCookie = start.cookies.find((c) => c.name === "__Host-todo_login")?.value ?? "";
    const { code, state } = issuer.approve(String(start.headers.location), username);
    const callback = await app.inject({
      method: "GET",
      url: `/auth/callback?code=${code}&state=${state}`,
      cookies: { "__Host-todo_login": loginCookie },
    });
    const session = callback.cookies.find((c) => c.name === "__Host-todo_session");
    return {
      start,
      callback,
      session,
      cookie: (session ? { "__Host-todo_session": session.value } : {}) as Record<string, string>,
    };
  }

  return { app, db, issuer, clock, signIn };
}
