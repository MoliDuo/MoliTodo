// Offline-first sync (standard 009, 9.7). The engine keeps a copy of the tasks as the server last had them
// (`tasks`, with deletion markers), the changes not sent yet (`pending`), and where to pull from (`cursor`).
// What the person sees is the copy with the pending changes laid over it. Sending a change that the server
// refuses because someone else changed the task first means the server's version wins; the refused content is
// kept in `conflicts` so it can be copied back.

import { positionAfter, positionBetween } from "./position";
import { MAX_DURATION_MINUTES, type Task, type TaskContent } from "./tasks";
import type { ChangesResponse, PutTaskBody } from "./tasks";

export interface PendingChange {
  content: TaskContent;
  /** The version the change is based on; 0 for a new task. */
  baseVersion: number;
  /** An add-only change (import): if the task already exists, drop it without a conflict notice. */
  quiet?: boolean;
}

export interface Conflict {
  id: string;
  /** What this device had; the server's version was kept instead. */
  discarded: TaskContent;
  at: number;
  reason: "conflict" | "rejected";
}

export interface SyncState {
  tasks: Record<string, Task>;
  pending: Record<string, PendingChange>;
  cursor: number;
  conflicts: Conflict[];
  lastSyncAt: number | null;
}

export const emptyState = (): SyncState => ({
  tasks: {},
  pending: {},
  cursor: 0,
  conflicts: [],
  lastSyncAt: null,
});

/** `idle`: last sync worked (or none yet). `offline`: network or server trouble, changes are kept and retried. */
export type SyncStatus = "idle" | "syncing" | "offline" | "auth" | "upgrade";

export type PutResult = { kind: "ok"; task: Task } | { kind: "conflict"; task: Task | null };

export interface Transport {
  put(id: string, body: PutTaskBody): Promise<PutResult>;
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

/** A task as the person sees it. */
export interface ViewTask extends TaskContent {
  id: string;
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

const contentOf = ({
  text,
  done,
  doneAt,
  archived,
  duration,
  position,
  deleted,
}: TaskContent): TaskContent => ({
  text,
  done,
  doneAt,
  archived,
  duration,
  position,
  deleted,
});

const byPosition = (a: ViewTask, b: ViewTask) =>
  a.position < b.position
    ? -1
    : a.position > b.position
      ? 1
      : a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0;

export interface EngineOptions {
  transport: Transport;
  state?: SyncState;
  now?: () => number;
  newId?: () => string;
  /** Called after every change to the state, so it can be saved and the screen redrawn. */
  onChange?: (state: SyncState, status: SyncStatus) => void;
}

export class SyncEngine {
  private state: SyncState;
  private status: SyncStatus = "idle";
  private running: Promise<SyncOutcome> | null = null;
  private again = false;
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(private readonly options: EngineOptions) {
    this.state = options.state ?? emptyState();
    this.now = options.now ?? Date.now;
    this.newId = options.newId ?? (() => crypto.randomUUID());
  }

  getState(): SyncState {
    return this.state;
  }

  getStatus(): SyncStatus {
    return this.status;
  }

  /** Every task still shown anywhere (deleted ones left out), in list order. */
  all(): ViewTask[] {
    const ids = new Set([...Object.keys(this.state.tasks), ...Object.keys(this.state.pending)]);
    const result: ViewTask[] = [];
    for (const id of ids) {
      const view = this.get(id);
      if (view && !view.deleted) result.push(view);
    }
    return result.sort(byPosition);
  }

  /** Not archived: the to-do list, finished tasks included until they are cleared. */
  list(): ViewTask[] {
    return this.all().filter((task) => !task.archived);
  }

  get(id: string): ViewTask | null {
    const pending = this.state.pending[id];
    const base = this.state.tasks[id];
    if (pending) {
      return { id, ...pending.content, version: base?.version ?? 0, unsynced: true };
    }
    if (!base) return null;
    return { id, ...contentOf(base), version: base.version, unsynced: false };
  }

  /** True when the task exists on this device, deleted or not. */
  knows(id: string): boolean {
    return id in this.state.tasks || id in this.state.pending;
  }

  /** The order key to give a task added at the end of the list. */
  nextPosition(): string {
    const last = this.all().at(-1);
    return positionAfter(last?.position ?? null);
  }

  add(text: string): string | null {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const id = this.newId();
    this.stage(id, {
      text: trimmed,
      done: false,
      doneAt: null,
      archived: false,
      duration: 0,
      position: this.nextPosition(),
      deleted: false,
    });
    return id;
  }

  /** Add-only: stages new tasks and never touches ones that exist (used by import). Returns how many were staged. */
  addMissing(items: { id: string; content: TaskContent }[]): number {
    let added = 0;
    for (const { id, content } of items) {
      if (this.knows(id)) continue;
      this.state.pending[id] = { content, baseVersion: 0, quiet: true };
      added += 1;
    }
    this.changed();
    return added;
  }

  update(id: string, patch: Partial<TaskContent>): void {
    const current = this.get(id);
    if (!current || current.deleted) return;
    const next = { ...contentOf(current), ...patch };
    if (typeof patch.text === "string") {
      next.text = patch.text.trim();
      if (!next.text) return;
    }
    next.duration = Math.min(Math.max(0, Math.round(next.duration)), MAX_DURATION_MINUTES);
    this.stage(id, next);
  }

  toggle(id: string): void {
    const current = this.get(id);
    if (!current) return;
    const done = !current.done;
    this.update(id, {
      done,
      doneAt: done ? this.now() : null,
      archived: done ? current.archived : false,
    });
  }

  remove(id: string): void {
    this.update(id, { deleted: true });
  }

  /** Moves finished tasks out of the to-do list; they stay in the completed view. */
  clearCompleted(): void {
    for (const task of this.list()) if (task.done) this.update(task.id, { archived: true });
  }

  /** Puts `id` right before `beforeId`, or at the end when `beforeId` is null. Only that task changes. */
  move(id: string, beforeId: string | null): void {
    const others = this.list().filter((task) => task.id !== id);
    const index =
      beforeId === null ? others.length : others.findIndex((task) => task.id === beforeId);
    if (index < 0) return;
    const before = others[index - 1]?.position ?? null;
    const after = others[index]?.position ?? null;
    this.update(id, { position: positionBetween(before, after) });
  }

  dismissConflict(id: string): void {
    this.state.conflicts = this.state.conflicts.filter((conflict) => conflict.id !== id);
    this.changed();
  }

  /** Replaces the whole copy, e.g. after signing in as someone else. */
  reset(): void {
    this.state = emptyState();
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

  private stage(id: string, content: TaskContent): void {
    const existing = this.state.pending[id];
    this.state.pending[id] = {
      content,
      baseVersion: existing ? existing.baseVersion : (this.state.tasks[id]?.version ?? 0),
      ...(existing?.quiet ? { quiet: true } : {}),
    };
    this.changed();
  }

  private async push(outcome: SyncOutcome): Promise<void> {
    for (const [id, sent] of Object.entries(this.state.pending)) {
      let result: PutResult;
      try {
        result = await this.options.transport.put(id, {
          ...sent.content,
          baseVersion: sent.baseVersion,
        });
      } catch (error) {
        if (error instanceof SyncError && error.kind === "rejected") {
          this.discard(id, sent, "rejected", outcome);
          continue;
        }
        throw error;
      }
      if (result.kind === "ok") {
        this.state.tasks[id] = result.task;
        const now = this.state.pending[id];
        if (now === sent) delete this.state.pending[id];
        else if (now) now.baseVersion = result.task.version;
      } else {
        if (result.task) this.state.tasks[id] = result.task;
        else delete this.state.tasks[id];
        this.discard(id, this.state.pending[id] ?? sent, sent.quiet ? null : "conflict", outcome);
      }
      this.changed();
    }
  }

  /** Drops a pending change; `reason` null drops it silently. */
  private discard(
    id: string,
    pending: PendingChange,
    reason: Conflict["reason"] | null,
    outcome: SyncOutcome
  ): void {
    delete this.state.pending[id];
    if (reason) {
      const conflict: Conflict = { id, discarded: pending.content, at: this.now(), reason };
      this.state.conflicts = [conflict, ...this.state.conflicts].slice(0, MAX_CONFLICTS);
      outcome.conflicts.push(conflict);
    }
    this.changed();
  }

  private async pull(): Promise<void> {
    for (;;) {
      const page = await this.options.transport.changes(this.state.cursor, PAGE);
      for (const task of page.tasks) {
        const have = this.state.tasks[task.id];
        if (!have || have.version < task.version) this.state.tasks[task.id] = task;
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
