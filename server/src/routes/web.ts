import fastifyStatic from "@fastify/static";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The web UI. Files that exist (scripts, icons) are public; the page itself is only served to a
 * signed-in browser. Anyone else is redirected to `/auth/login`, which ends at Authelia (8.4.4).
 */
export function webRoutes(app: FastifyInstance, webDist: string) {
  const root = resolve(webDist);
  if (!existsSync(root)) {
    app.log.warn({ root }, "web UI is not built; only the API is served");
    return;
  }

  app.register(fastifyStatic, {
    root,
    index: false,
    wildcard: true,
    cacheControl: true,
    maxAge: "1h",
    // The page itself is only handed out by the signed-in route below.
    allowedPath: (path) => !/^\/index\.html?$/.test(path),
  });

  const page = async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.auth?.via !== "session") {
      const next = encodeURIComponent(request.url);
      return reply.redirect(`/auth/login?next=${next}`, 302);
    }
    return reply
      .header("cache-control", "no-store")
      .type("text/html; charset=utf-8")
      .sendFile("index.html", { cacheControl: false });
  };

  app.get("/", page);
  app.setNotFoundHandler(async (request, reply) => {
    const path = request.url.split("?")[0] ?? "";
    const looksLikeFile = /\.[A-Za-z0-9]+$/.test(path);
    if (request.method !== "GET" || path.startsWith("/api/") || looksLikeFile) {
      return reply.status(404).send({ error: { code: "not_found", message: "Not found" } });
    }
    return page(request, reply);
  });
}
