import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  MAX_CHANGES_PAGE,
  putTaskBodySchema,
  taskIdSchema,
  type ConflictResponse,
} from "@shared/tasks";
import { requireAuth } from "../auth/request-auth.js";
import type { TaskStore } from "../tasks/store.js";

const changesQuerySchema = z.object({
  cursor: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(MAX_CHANGES_PAGE).default(200),
});

/** Sync interface (standard 009, 9.7): pull changes by cursor, push one task with the version it was based on. */
export function taskRoutes(app: FastifyInstance, store: TaskStore) {
  app.get("/api/v1/tasks/changes", { preHandler: requireAuth }, async (request) => {
    const { cursor, limit } = changesQuerySchema.parse(request.query);
    return store.changes(request.auth?.username ?? "", cursor, limit);
  });

  app.put("/api/v1/tasks/:id", { preHandler: requireAuth }, async (request, reply) => {
    const id = taskIdSchema.parse((request.params as { id?: string }).id);
    const body = putTaskBodySchema.parse(request.body);
    const result = store.put(request.auth?.username ?? "", id, body);
    if (result.kind === "ok") return { task: result.task };
    const conflict: ConflictResponse = {
      error: { code: "conflict", message: "The task was changed elsewhere" },
      task: result.task,
    };
    return reply.status(409).send(conflict);
  });
}
