import type { FastifyReply, FastifyRequest } from "fastify";
import { OidcError, type OidcClient } from "./oidc.js";
import type { SessionStore } from "./stores.js";

export const SESSION_COOKIE = "__Host-todo_session";
export const LOGIN_COOKIE = "__Host-todo_login";

export interface AuthContext {
  username: string;
  name: string | null;
  email: string | null;
  /** The two ways in are kept apart (standard 008, 8.7.4): a request is one or the other. */
  via: "session" | "bearer";
}

declare module "fastify" {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

/** Sends the JSON error body every client expects. */
export function sendError(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.status(status).send({ error: { code, message } });
}

/**
 * Works out who the request is from. A request that carries `Authorization: Bearer` is judged on the
 * token alone and its cookies are ignored; otherwise the session cookie decides.
 */
export async function authenticate(
  request: FastifyRequest,
  deps: { oidc: OidcClient; sessions: SessionStore }
): Promise<AuthContext | null> {
  const header = request.headers.authorization;
  if (header !== undefined) {
    const match = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/.exec(header);
    if (!match?.[1]) return null;
    try {
      const identity = await deps.oidc.verifyBearerToken(match[1]);
      return { ...identity, via: "bearer" };
    } catch (error) {
      if (error instanceof OidcError) return null;
      throw error;
    }
  }
  const cookie = request.cookies[SESSION_COOKIE];
  if (!cookie) return null;
  const user = deps.sessions.find(cookie);
  return user ? { ...user, via: "session" } : null;
}

/** preHandler for routes that need a signed-in user: 401 with a JSON body otherwise. */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  if (!request.auth) return sendError(reply, 401, "unauthorized", "Sign in required");
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Cookie sessions must prove the write came from our own pages (standard 008, 8.5.7). */
export function originGuard(appOrigin: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (SAFE_METHODS.has(request.method) || request.auth?.via !== "session") return;
    if (request.headers.origin !== appOrigin) {
      return sendError(reply, 403, "bad_origin", "Cross-site request refused");
    }
  };
}
