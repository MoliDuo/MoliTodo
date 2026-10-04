import type { FastifyReply, FastifyRequest } from "fastify";
import { CLIENT_HEADER } from "@shared/tasks";

/** "todo-web/2.0.1" -> [2, 0, 1]; null when the header is missing or not in that form. */
export function parseClientVersion(header: string | string[] | undefined): number[] | null {
  if (typeof header !== "string") return null;
  const match = /^[A-Za-z][\w-]*\/(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(header);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

const isOlder = (version: number[], minimum: number[]): boolean => {
  for (let i = 0; i < 3; i += 1) {
    const a = version[i] ?? 0;
    const b = minimum[i] ?? 0;
    if (a !== b) return a < b;
  }
  return false;
};

/**
 * preHandler for `/api/` routes: a client that says it is older than the configured minimum is told to update (426).
 * That includes a website tab opened before the last deploy (`todo-web/<version>`), which then reloads itself.
 * Requests that send no version, or one in another form, are let through.
 */
export function minClientVersionGuard(minimum: string | undefined) {
  const min = minimum ? minimum.split(".").map(Number) : null;
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!min || !request.url.startsWith("/api/")) return;
    const version = parseClientVersion(request.headers[CLIENT_HEADER]);
    if (version && isOlder(version, min)) {
      return reply.status(426).send({
        error: { code: "upgrade_required", message: "Please update the app" },
        minVersion: minimum,
      });
    }
  };
}
