import { and, asc, eq, gt, sql } from "drizzle-orm";
import type { ChangesResponse, RecordKind, SyncRecord } from "@shared/records";
import type { Db } from "../db/client.js";
import { records } from "../db/schema.js";

type Row = typeof records.$inferSelect;

const toRecord = (row: Row): SyncRecord => ({
  kind: row.kind as RecordKind,
  id: row.id,
  data: JSON.parse(row.data) as unknown,
  deleted: row.deleted,
  version: row.version,
});

export interface RecordChange {
  /** Already checked against the kind's schema. */
  data: unknown;
  deleted: boolean;
  baseVersion: number;
}

export type PutResult =
  { kind: "ok"; record: SyncRecord } | { kind: "conflict"; record: SyncRecord | null };

/** All record reads and writes. Every call is scoped to one owner: nobody sees another person's records. */
export class RecordStore {
  constructor(
    private readonly db: Db,
    private readonly now: () => number = Date.now
  ) {}

  /** Changes after `cursor`, oldest first, deletion markers included. */
  changes(owner: string, cursor: number, limit: number): ChangesResponse {
    const rows = this.db
      .select()
      .from(records)
      .where(and(eq(records.owner, owner), gt(records.seq, cursor)))
      .orderBy(asc(records.seq))
      .limit(limit + 1)
      .all();
    const page = rows.slice(0, limit);
    return {
      records: page.map(toRecord),
      cursor: page.length > 0 ? (page[page.length - 1] as Row).seq : cursor,
      hasMore: rows.length > limit,
    };
  }

  /**
   * Applies one change when it is based on the current version (0 for a new record), else reports the conflict
   * with the server's current value. Re-sending a change that already went through is not a conflict.
   */
  put(owner: string, kind: RecordKind, id: string, change: RecordChange): PutResult {
    const data = JSON.stringify(change.data);
    const where = and(eq(records.owner, owner), eq(records.kind, kind), eq(records.id, id));
    return this.db.transaction((tx) => {
      const existing = tx.select().from(records).where(where).get();
      if ((existing?.version ?? 0) !== change.baseVersion) {
        if (existing && existing.data === data && existing.deleted === change.deleted) {
          return { kind: "ok", record: toRecord(existing) };
        }
        return { kind: "conflict", record: existing ? toRecord(existing) : null };
      }
      const seq =
        (tx
          .select({ max: sql<number>`coalesce(max(${records.seq}), 0)` })
          .from(records)
          .where(eq(records.owner, owner))
          .get()?.max ?? 0) + 1;
      const version = change.baseVersion + 1;
      const values = { data, deleted: change.deleted, version, seq, updatedAt: this.now() };
      if (existing) tx.update(records).set(values).where(where).run();
      else
        tx.insert(records)
          .values({ owner, kind, id, ...values })
          .run();
      return {
        kind: "ok",
        record: { kind, id, data: change.data, deleted: change.deleted, version },
      };
    });
  }
}
