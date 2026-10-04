import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { authenticate, originGuard, requireAuth, sendError } from "./auth/request-auth.js";
import { OidcClient } from "./auth/oidc.js";
import { LoginStore, SessionStore } from "./auth/stores.js";
import type { Config } from "./config.js";
import type { Db } from "./db/client.js";
import { authRoutes } from "./routes/auth.js";
import { taskRoutes } from "./routes/tasks.js";
import { webRoutes } from "./routes/web.js";
import { minClientVersionGuard } from "./client-version.js";
import { TaskStore } from "./tasks/store.js";
import { meResponseSchema } from "@shared/api";

export interface AppDeps {
  config: Config;
  db: Db;
  fetch?: typeof fetch;
  now?: () => number;
  logger?: boolean;
  /** Registers extra routes before the server starts (used by tests). */
  extend?: (app: FastifyInstance) => void;
}

/** Builds the server. Everything outside the process (database, identity service, clock) comes in as a parameter. */
export function buildApp(deps: AppDeps): FastifyInstance {
  const { config, db } = deps;
  const now = deps.now ?? Date.now;
  const app = Fastify({
    logger: deps.logger ? { redact: ["req.headers.authorization", "req.headers.cookie"] } : false,
    trustProxy: true,
  });
  app.register(cookie);

  const oidc = new OidcClient({
    issuer: config.OIDC_ISSUER,
    clientId: config.OIDC_CLIENT_ID,
    clientSecret: config.OIDC_CLIENT_SECRET,
    nativeClientId: config.OIDC_NATIVE_CLIENT_ID,
    redirectUri: `${config.APP_URL}/auth/callback`,
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
    now,
  });
  const sessions = new SessionStore(db, now, config.SESSION_DAYS * 24 * 60 * 60 * 1000);
  const logins = new LoginStore(db, now);

  app.decorateRequest("auth", null);
  app.addHook("onRequest", async (request) => {
    request.auth = await authenticate(request, { oidc, sessions });
  });
  app.addHook("preHandler", minClientVersionGuard(config.MIN_CLIENT_VERSION));
  app.addHook("preHandler", originGuard(config.APP_URL));
  app.addHook("onSend", async (_request, reply) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "same-origin");
    reply.header("x-frame-options", "DENY");
    reply.header(
      "content-security-policy",
      "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    );
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) return sendError(reply, 400, "bad_request", "Invalid request");
    request.log.error({ err: error }, "request failed");
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return sendError(reply, status, "bad_request", "Invalid request");
    }
    return sendError(reply, 500, "internal", "Something went wrong");
  });

  app.get("/healthz", async () => ({ ok: true, version: config.APP_VERSION }));

  authRoutes(app, { oidc, logins, sessions });

  app.get("/api/v1/me", { preHandler: requireAuth }, async (request) =>
    meResponseSchema.parse({
      username: request.auth?.username,
      name: request.auth?.name ?? null,
      email: request.auth?.email ?? null,
      via: request.auth?.via,
    })
  );

  taskRoutes(app, new TaskStore(db));

  deps.extend?.(app);
  webRoutes(app, config.WEB_DIST);
  return app;
}
