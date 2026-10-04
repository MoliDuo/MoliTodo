import { z } from "zod";

/** A single task is longer than this only by mistake (100 hours). */
export const MAX_DURATION_MINUTES = 100 * 60;
export const MAX_TEXT_LENGTH = 2000;
export const MAX_CHANGES_PAGE = 500;

/** Client-made ids: UUIDs, or the fixed ids the legacy import derives. */
export const taskIdSchema = z.string().regex(/^[A-Za-z0-9-]{8,64}$/);
/** Order keys (see position.ts): letters and digits, never ending in "0". */
export const positionSchema = z.string().regex(/^[0-9A-Za-z]{0,63}[1-9A-Za-z]$/);

const taskFields = {
  text: z.string().trim().min(1).max(MAX_TEXT_LENGTH),
  done: z.boolean(),
  /** When it was completed, ms since the epoch; null while not done (or when unknown). */
  doneAt: z.number().int().min(0).nullable(),
  /** Removed from the to-do list but kept in the completed view. */
  archived: z.boolean(),
  /** Minutes spent. */
  duration: z.number().int().min(0).max(MAX_DURATION_MINUTES),
  position: positionSchema,
  /** A deleted task stays as a marker so other devices do not bring it back (standard 009, 9.7.4). */
  deleted: z.boolean(),
};

/** What the server stores and returns. `version` goes up by one on every change. */
export const taskSchema = z.object({
  id: taskIdSchema,
  ...taskFields,
  version: z.number().int().min(1),
});
export type Task = z.infer<typeof taskSchema>;

/** The editable part of a task. */
export const taskContentSchema = z.object(taskFields);
export type TaskContent = z.infer<typeof taskContentSchema>;

/** `PUT /api/v1/tasks/:id`. `baseVersion` is the version the change is based on: 0 to create. */
export const putTaskBodySchema = taskContentSchema.extend({
  baseVersion: z.number().int().min(0),
});
export type PutTaskBody = z.infer<typeof putTaskBodySchema>;

/** `GET /api/v1/tasks/changes?cursor=&limit=` */
export const changesResponseSchema = z.object({
  tasks: z.array(taskSchema),
  /** Pass this back as `cursor` next time. */
  cursor: z.number().int().min(0),
  hasMore: z.boolean(),
});
export type ChangesResponse = z.infer<typeof changesResponseSchema>;

/** 200 answer of a successful PUT. */
export const putTaskResponseSchema = z.object({ task: taskSchema });

/** 409: someone else changed the task first; `task` is how the server has it now (null if it has none). */
export const conflictResponseSchema = z.object({
  error: z.object({ code: z.literal("conflict"), message: z.string() }),
  task: taskSchema.nullable(),
});
export type ConflictResponse = z.infer<typeof conflictResponseSchema>;

/** Header every client sends: `<client>/<version>`, e.g. `todo-desktop/2.0.0`. */
export const CLIENT_HEADER = "x-moli-client";
