// Offline-first sync (standard 009, 9.7). The engine keeps a copy of the records as the server last had them
// (`records`, with deletion markers), the changes not sent yet (`pending`), and where to pull from (`cursor`).
// What the person sees is the copy with the pending changes laid over it. Sending a change that the server
// refuses because someone else changed the record first means the server's version wins; the refused content is
// kept in `conflicts`.

import type {
  ChangesResponse,
  PutRecordBody,
  RecordDataByKind,
  RecordKind,
  SyncRecord,
} from "@shared/records";

/** "kind/id": records of different kinds may share an id. */
export type RecordKey = `${RecordKind}/${string}`;
export const keyOf = (kind: RecordKind, id: string): RecordKey => `${kind}/${id}`;

export interface RecordContent {
  data: unknown;
  deleted: boolean;
}

export interface PendingChange extends RecordContent {
  kind: RecordKind;
  id: string;
  /** The version the change is based on; 0 for a new record. */
  baseVersion: number;
}

export interface Conflict {
  kind: RecordKind;
  id: string;
  /** What this device had; the server's version was kept instead. */
  discarded: RecordContent;
  at: number;
  reason: "conflict" | "rejected";
}

export interface SyncState {
  records: Record<RecordKey, SyncRecord>;
  pending: Record<RecordKey, PendingChange>;
  cursor: number;
  conflicts: Conflict[];
  lastSyncAt: number | null;
  /** True once a pull has finished, so screens can tell "empty" from "not loaded yet". */
  loaded: boolean;
}

export const emptyState = (): SyncState => ({
  records: {},
  pending: {},
  cursor: 0,
  conflicts: [],
  lastSyncAt: null,
  loaded: false,
});

/** `idle`: last sync worked (or none yet). `offline`: network or server trouble, changes are kept and retried. */
export type SyncStatus = "idle" | "syncing" | "offline" | "auth" | "upgrade";

export type PutResult =
  { kind: "ok"; record: SyncRecord } | { kind: "conflict"; record: SyncRecord | null };

export interface Transport {
  put(kind: RecordKind, id: string, body: PutRecordBody): Promise<PutResult>;
  changes(cursor: number, limit: number): Promise<ChangesResponse>;
}

/**
 * What a transport throws. `offline`: no network or a server error (retry later); `auth`: 401/403 (sign in
 * again; local data stays); `upgrade`: 426 (this app is too old); `rejected`: 400, the server will never accept
 * this change.
 */
export class SyncError extends Error {
  readonly kind: "offline" | "auth" | "upgrade" | "rejected";

  constructor(kind: "offline" | "auth" | "upgrade" | "rejected", message?: string) {
    super(message ?? kind);
    this.kind = kind;
  }
}

/** A record as the person sees it. */
export interface View<K extends RecordKind = RecordKind> {
  kind: K;
  id: string;
  data: RecordDataByKind[K];
  version: number;
  /** Not sent to the server yet. */
  unsynced: boolean;
}

export interface SyncOutcome {
  status: SyncStatus;
  /** Conflicts found by this run. */
  conflicts: Conflict[];
}

const MAX_CONFLICTS = 50;
const PAGE = 200;

export interface EngineOptions {
  transport: Transport;
  state?: SyncState;
  now?: () => number;
  /** Called after every change to the state, so the screen can be redrawn. */
  onChange?: (state: SyncState, status: SyncStatus) => void;
}

export class SyncEngine {
  private state: SyncState;
  private status: SyncStatus = "idle";
  private running: Promise<SyncOutcome> | null = null;
  private again = false;
  private readonly now: () => number;

  constructor(private readonly options: EngineOptions) {
    this.state = options.state ?? emptyState();
    this.now = options.now ?? Date.now;
  }

  getState(): SyncState {
    return this.state;
  }

  getStatus(): SyncStatus {
    return this.status;
  }

  /** The record as it is shown, or null when there is none or it was deleted. */
  get<K extends RecordKind>(kind: K, id: string): View<K> | null {
    const key = keyOf(kind, id);
    const pending = this.state.pending[key];
    const base = this.state.records[key];
    const content = pending ?? base;
    if (!content || content.deleted) return null;
    return {
      kind,
      id,
      data: content.data as RecordDataByKind[K],
      version: base?.version ?? 0,
      unsynced: Boolean(pending),
    };
  }

  /** Every record of a kind still shown (deleted ones left out), in no particular order. */
  all<K extends RecordKind>(kind: K): View<K>[] {
    const prefix = `${kind}/`;
    const ids = new Set<string>();
    for (const source of [this.state.records, this.state.pending]) {
      for (const key of Object.keys(source)) {
        if (key.startsWith(prefix)) ids.add(key.slice(prefix.length));
      }
    }
    const result: View<K>[] = [];
    for (const id of ids) {
      const view = this.get(kind, id);
      if (view) result.push(view);
    }
    return result;
  }

  /** Stages new content for a record (creating it when there is none). */
  put<K extends RecordKind>(kind: K, id: string, data: RecordDataByKind[K]): void {
    this.stage(kind, id, { data, deleted: false });
  }

  /** Merges a patch into a shown record; does nothing when the record is not shown. */
  update<K extends RecordKind>(kind: K, id: string, patch: Partial<RecordDataByKind[K]>): void {
    const current = this.get(kind, id);
    if (!current) return;
    this.put(kind, id, { ...current.data, ...patch });
  }

  remove(kind: RecordKind, id: string): void {
    const key = keyOf(kind, id);
    const content = this.state.pending[key] ?? this.state.records[key];
    if (!content || content.deleted) return;
    this.stage(kind, id, { data: content.data, deleted: true });
  }

  dismissConflict(conflict: Conflict): void {
    this.state.conflicts = this.state.conflicts.filter((c) => c !== conflict);
    this.changed();
  }

  /** Sends pending changes, then pulls what changed elsewhere. Calls made while one is running join it. */
  sync(): Promise<SyncOutcome> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    const run = (async () => {
      const outcome: SyncOutcome = { status: "idle", conflicts: [] };
      try {
        do {
          this.again = false;
          this.setStatus("syncing");
          await this.push(outcome);
          await this.pull();
        } while (this.again);
        this.state.lastSyncAt = this.now();
        this.state.loaded = true;
        this.setStatus("idle");
      } catch (error) {
        this.setStatus(
          error instanceof SyncError && error.kind !== "rejected" ? error.kind : "offline"
        );
      } finally {
        this.running = null;
      }
      outcome.status = this.status;
      return outcome;
    })();
    this.running = run;
    return run;
  }

  private stage(kind: RecordKind, id: string, content: RecordContent): void {
    const key = keyOf(kind, id);
    const existing = this.state.pending[key];
    this.state.pending[key] = {
      kind,
      id,
      ...content,
      baseVersion: existing ? existing.baseVersion : (this.state.records[key]?.version ?? 0),
    };
    this.changed();
  }

  private async push(outcome: SyncOutcome): Promise<void> {
    for (const [key, sent] of Object.entries(this.state.pending) as [RecordKey, PendingChange][]) {
      let result: PutResult;
      try {
        result = await this.options.transport.put(sent.kind, sent.id, {
          data: sent.data,
          deleted: sent.deleted,
          baseVersion: sent.baseVersion,
        });
      } catch (error) {
        if (error instanceof SyncError && error.kind === "rejected") {
          this.discard(key, sent, "rejected", outcome);
          continue;
        }
        throw error;
      }
      if (result.kind === "ok") {
        this.state.records[key] = result.record;
        const now = this.state.pending[key];
        if (now === sent) delete this.state.pending[key];
        else if (now) now.baseVersion = result.record.version;
      } else {
        if (result.record) this.state.records[key] = result.record;
        else delete this.state.records[key];
        this.discard(key, this.state.pending[key] ?? sent, "conflict", outcome);
      }
      this.changed();
    }
  }

  private discard(
    key: RecordKey,
    pending: PendingChange,
    reason: Conflict["reason"],
    outcome: SyncOutcome
  ): void {
    delete this.state.pending[key];
    const conflict: Conflict = {
      kind: pending.kind,
      id: pending.id,
      discarded: { data: pending.data, deleted: pending.deleted },
      at: this.now(),
      reason,
    };
    this.state.conflicts = [conflict, ...this.state.conflicts].slice(0, MAX_CONFLICTS);
    outcome.conflicts.push(conflict);
    this.changed();
  }

  private async pull(): Promise<void> {
    for (;;) {
      const page = await this.options.transport.changes(this.state.cursor, PAGE);
      for (const record of page.records) {
        const key = keyOf(record.kind, record.id);
        const have = this.state.records[key];
        if (!have || have.version < record.version) this.state.records[key] = record;
      }
      this.state.cursor = page.cursor;
      this.changed();
      if (!page.hasMore) return;
    }
  }

  private setStatus(status: SyncStatus): void {
    this.status = status;
    this.changed();
  }

  private changed(): void {
    this.options.onChange?.(this.state, this.status);
  }
}
