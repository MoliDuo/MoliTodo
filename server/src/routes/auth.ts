import type { FastifyInstance } from "fastify";
import { OidcError, type OidcClient } from "../auth/oidc.js";
import { LOGIN_COOKIE, SESSION_COOKIE } from "../auth/request-auth.js";
import { LOGIN_TTL_MS, type LoginStore, type SessionStore } from "../auth/stores.js";

/** Only same-site paths that are not ours (`/auth`, `/api`) are allowed as the place to return to. */
export function safeNext(value: unknown): string {
  if (typeof value !== "string" || !/^\/(?![/\\])[^\s]*$/.test(value)) return "/";
  if (/^\/(auth|api)(\/|$|\?)/.test(value)) return "/";
  return value;
}

const failurePage = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Moli Todo</title></head>
<body style="font-family:system-ui,sans-serif;max-width:28rem;margin:4rem auto;padding:0 1rem">
<h1 style="font-size:1.25rem">登录没有成功</h1>
<p>这次登录没有完成，可能是页面停留太久，或登录信息有误。请重新登录。</p>
<p><a href="/auth/login">重新登录</a></p>
</body></html>`;

interface Deps {
  oidc: OidcClient;
  logins: LoginStore;
  sessions: SessionStore;
}

/** The browser keeps the cookie as long as it allows; the server-side expiry slides and decides. */
const SESSION_COOKIE_MAX_AGE_S = 400 * 24 * 60 * 60;

/**
 * `/auth/login` is an app-owned start endpoint, not a page: it only redirects to Authelia
 * (standard 008, 8.4.4). `/auth/callback` finishes the sign-in and starts our own session (8.5).
 */
export function authRoutes(app: FastifyInstance, deps: Deps) {
  const cookieBase = { path: "/", httpOnly: true, secure: true, sameSite: "lax" } as const;

  app.get("/auth/login", async (request, reply) => {
    const next = safeNext((request.query as { next?: string }).next);
    const attempt = deps.logins.create(next);
    const url = await deps.oidc.authorizeUrl(attempt);
    // Binds the attempt to this browser, so a link someone else started cannot be finished here.
    reply.setCookie(LOGIN_COOKIE, attempt.state, { ...cookieBase, maxAge: LOGIN_TTL_MS / 1000 });
    return reply.redirect(url, 302);
  });

  app.get("/auth/callback", async (request, reply) => {
    const { code, state } = request.query as { code?: string; state?: string };
    const bound = request.cookies[LOGIN_COOKIE];
    reply.clearCookie(LOGIN_COOKIE, { path: "/" });
    const fail = (reason: string) => {
      request.log.warn({ reason }, "sign-in refused");
      return reply.status(400).type("text/html; charset=utf-8").send(failurePage);
    };
    if (typeof code !== "string" || typeof state !== "string" || bound !== state) {
      return fail("missing or mismatched state");
    }
    const attempt = deps.logins.consume(state);
    if (!attempt) return fail("unknown or expired state");
    try {
      const idToken = await deps.oidc.exchangeCode(code, attempt.codeVerifier);
      const identity = await deps.oidc.verifyIdToken(idToken, attempt.nonce);
      const session = deps.sessions.start(identity);
      reply.setCookie(SESSION_COOKIE, session.id, {
        ...cookieBase,
        maxAge: SESSION_COOKIE_MAX_AGE_S,
      });
      return reply.redirect(attempt.next, 302);
    } catch (error) {
      return fail(error instanceof OidcError ? error.message : "token exchange failed");
    }
  });
}
