import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { fileIdSchema, FILE_TYPES, MAX_FILE_BYTES } from "@shared/records";
import { requireAuth, sendError } from "../auth/request-auth.js";
import type { Db } from "../db/client.js";
import { files } from "../db/schema.js";

const paramsSchema = z.object({ id: fileIdSchema });
const isFileType = (type: string): type is (typeof FILE_TYPES)[number] =>
  (FILE_TYPES as readonly string[]).includes(type);

/**
 * Pictures attached to tasks. The body of the upload is the picture itself; the answer is its id, which the task
 * keeps. Every call is scoped to the signed-in person: nobody can read another person's pictures.
 */
export function fileRoutes(app: FastifyInstance, db: Db, now: () => number) {
  app.register(async (scope) => {
    // Pictures arrive as raw bytes; only this scope accepts them, and only up to the size limit.
    scope.addContentTypeParser(
      [...FILE_TYPES],
      { parseAs: "buffer", bodyLimit: MAX_FILE_BYTES },
      (_request, body, done) => done(null, body)
    );

    scope.post("/api/v2/files", { preHandler: requireAuth }, async (request, reply) => {
      const type = (request.headers["content-type"] ?? "").split(";")[0]?.trim() ?? "";
      const bytes = request.body;
      if (!isFileType(type) || !Buffer.isBuffer(bytes) || bytes.length === 0) {
        return sendError(reply, 400, "bad_request", "Send a JPEG, PNG or WebP picture");
      }
      const id = randomUUID();
      db.insert(files)
        .values({
          owner: request.auth?.username ?? "",
          id,
          mime: type,
          bytes,
          size: bytes.length,
          createdAt: now(),
        })
        .run();
      return { id };
    });

    scope.get("/api/v2/files/:id", { preHandler: requireAuth }, async (request, reply) => {
      const { id } = paramsSchema.parse(request.params);
      const row = db
        .select()
        .from(files)
        .where(and(eq(files.owner, request.auth?.username ?? ""), eq(files.id, id)))
        .get();
      if (!row) return sendError(reply, 404, "not_found", "No such file");
      // A file never changes once uploaded, so the browser may keep it.
      return reply
        .header("content-type", row.mime)
        .header("cache-control", "private, max-age=31536000, immutable")
        .send(row.bytes);
    });

    scope.delete("/api/v2/files/:id", { preHandler: requireAuth }, async (request) => {
      const { id } = paramsSchema.parse(request.params);
      db.delete(files)
        .where(and(eq(files.owner, request.auth?.username ?? ""), eq(files.id, id)))
        .run();
      return { ok: true };
    });
  });
}
