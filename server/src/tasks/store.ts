import { and, asc, eq, gt, sql } from "drizzle-orm";
import type { ChangesResponse, PutTaskBody, Task, TaskContent } from "@shared/tasks";
import type { Db } from "../db/client.js";
import { tasks } from "../db/schema.js";

type Row = typeof tasks.$inferSelect;

const toTask = (row: Row): Task => ({
  id: row.id,
  text: row.text,
  done: row.done,
  doneAt: row.doneAt,
  archived: row.archived,
  duration: row.duration,
  position: row.position,
  deleted: row.deleted,
  version: row.version,
});

const sameContent = (task: Task, content: TaskContent): boolean =>
  task.text === content.text &&
  task.done === content.done &&
  task.doneAt === content.doneAt &&
  task.archived === content.archived &&
  task.duration === content.duration &&
  task.position === content.position &&
  task.deleted === content.deleted;

export type PutResult = { kind: "ok"; task: Task } | { kind: "conflict"; task: Task | null };

/** All task reads and writes. Every call is scoped to one owner: nobody sees another person's tasks. */
export class TaskStore {
  constructor(private readonly db: Db) {}

  get(owner: string, id: string): Task | null {
    const row = this.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.owner, owner), eq(tasks.id, id)))
      .get();
    return row ? toTask(row) : null;
  }

  /** Changes after `cursor`, oldest first, deletion markers included. */
  changes(owner: string, cursor: number, limit: number): ChangesResponse {
    const rows = this.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.owner, owner), gt(tasks.seq, cursor)))
      .orderBy(asc(tasks.seq))
      .limit(limit + 1)
      .all();
    const page = rows.slice(0, limit);
    return {
      tasks: page.map(toTask),
      cursor: page.length > 0 ? (page[page.length - 1] as Row).seq : cursor,
      hasMore: rows.length > limit,
    };
  }

  /**
   * Applies one change when it is based on the current version (0 for a new task), else reports the conflict
   * with the server's current value. Re-sending a change that already went through is not a conflict.
   */
  put(owner: string, id: string, body: PutTaskBody): PutResult {
    const { baseVersion, ...content } = body;
    return this.db.transaction((tx) => {
      const existing = tx
        .select()
        .from(tasks)
        .where(and(eq(tasks.owner, owner), eq(tasks.id, id)))
        .get();
      const current = existing ? toTask(existing) : null;
      if ((current?.version ?? 0) !== baseVersion) {
        if (current && sameContent(current, content)) return { kind: "ok", task: current };
        return { kind: "conflict", task: current };
      }
      const seq =
        (tx
          .select({ max: sql<number>`coalesce(max(${tasks.seq}), 0)` })
          .from(tasks)
          .where(eq(tasks.owner, owner))
          .get()?.max ?? 0) + 1;
      const version = baseVersion + 1;
      const values = { ...content, version, seq };
      if (current) {
        tx.update(tasks)
          .set(values)
          .where(and(eq(tasks.owner, owner), eq(tasks.id, id)))
          .run();
      } else {
        tx.insert(tasks)
          .values({ owner, id, ...values })
          .run();
      }
      return { kind: "ok", task: { id, ...content, version } };
    });
  }
}
