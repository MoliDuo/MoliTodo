import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  MAX_CHANGES_PAGE,
  putRecordBodySchema,
  recordDataSchemas,
  recordIdSchema,
  recordKindSchema,
  type ConflictResponse,
} from "@shared/records";
import { requireAuth } from "../auth/request-auth.js";
import type { RecordStore } from "../records/store.js";

const changesQuerySchema = z.object({
  cursor: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(MAX_CHANGES_PAGE).default(200),
});

const paramsSchema = z.object({ kind: recordKindSchema, id: recordIdSchema });

/** Sync interface (standard 009, 9.7): pull changes by cursor, push one record with the version it was based on. */
export function recordRoutes(app: FastifyInstance, store: RecordStore) {
  app.get("/api/v2/changes", { preHandler: requireAuth }, async (request) => {
    const { cursor, limit } = changesQuerySchema.parse(request.query);
    return store.changes(request.auth?.username ?? "", cursor, limit);
  });

  app.put("/api/v2/records/:kind/:id", { preHandler: requireAuth }, async (request, reply) => {
    const { kind, id } = paramsSchema.parse(request.params);
    const body = putRecordBodySchema.parse(request.body);
    const data = recordDataSchemas[kind].parse(body.data);
    const result = store.put(request.auth?.username ?? "", kind, id, { ...body, data });
    if (result.kind === "ok") return { record: result.record };
    const conflict: ConflictResponse = {
      error: { code: "conflict", message: "The record was changed elsewhere" },
      record: result.record,
    };
    return reply.status(409).send(conflict);
  });

  // The task interface of 2.x is gone. A page opened before the update still calls it: tell it to reload.
  app.all("/api/v1/tasks/*", async (_request, reply) =>
    reply.status(426).send({
      error: { code: "upgrade_required", message: "Please update the app" },
    })
  );
}
