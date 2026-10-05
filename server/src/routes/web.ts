import fastifyStatic from "@fastify/static";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const NOT_FOUND = { error: { code: "not_found", message: "Not found" } };

/**
 * How long a browser may keep a file. Built scripts and styles carry a hash in their names, so a new build never
 * reuses a name. The service worker and the manifest must be checked on every visit, or a new version is not seen.
 * Everything else keeps the default (an hour).
 */
function cacheControlFor(path: string): string | null {
  if (path.startsWith("/assets/")) return "public, max-age=31536000, immutable";
  if (path.startsWith("/covers/")) return "public, max-age=604800";
  if (/^\/(sw\.js|workbox-[^/]+\.js|manifest\.webmanifest)$/.test(path)) return "no-cache";
  return null;
}

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
    // The page itself is only handed out by the signed-in routes below.
    allowedPath: (path) => !/^\/index\.html?$/.test(path),
    setHeaders: (reply, path) => {
      const cacheControl = cacheControlFor(path.slice(root.length));
      if (cacheControl) reply.header("cache-control", cacheControl);
    },
  });

  const page = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.auth) {
      const next = encodeURIComponent(request.url);
      return reply.redirect(`/auth/login?next=${next}`, 302);
    }
    return reply
      .header("cache-control", "no-store")
      .type("text/html; charset=utf-8")
      .sendFile("index.html", { cacheControl: false });
  };

  app.get("/", page);
  // The service worker keeps a copy of the page; it asks for it by this name, signed in.
  app.get("/index.html", async (request, reply) => {
    if (!request.auth) return reply.status(404).send(NOT_FOUND);
    return page(request, reply);
  });
  app.setNotFoundHandler(async (request, reply) => {
    const path = request.url.split("?")[0] ?? "";
    const looksLikeFile = /\.[A-Za-z0-9]+$/.test(path);
    if (request.method !== "GET" || path.startsWith("/api/") || looksLikeFile) {
      return reply.status(404).send(NOT_FOUND);
    }
    return page(request, reply);
  });
}
