import type { FastifyReply, FastifyRequest } from "fastify";
import type { SessionStore } from "./stores.js";

export const SESSION_COOKIE = "__Host-todo_session";
export const LOGIN_COOKIE = "__Host-todo_login";

export interface AuthContext {
  username: string;
  name: string | null;
  email: string | null;
  /** Always a cookie session: the website is the only client. */
  via: "session";
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

/** Works out who the request is from: the session cookie decides; an `Authorization` header is ignored. */
export function authenticate(
  request: FastifyRequest,
  deps: { sessions: SessionStore }
): AuthContext | null {
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
    if (SAFE_METHODS.has(request.method) || !request.auth) return;
    if (request.headers.origin !== appOrigin) {
      return sendError(reply, 403, "bad_origin", "Cross-site request refused");
    }
  };
}
