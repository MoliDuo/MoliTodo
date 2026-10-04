// Import of the old 哞哞清单 task file (`store.json`). Add-only: a task is added under an id worked out from its
// old id, so importing again, on this or another device, finds the same ids and skips them. Tasks that were
// edited or deleted after the first import are therefore never overwritten or brought back.

import { positionAfter } from "./position";
import { MAX_DURATION_MINUTES, MAX_TEXT_LENGTH, type TaskContent } from "@shared/tasks";

export interface ImportPlan {
  /** Tasks to add, in the order of the old list. */
  items: { id: string; content: TaskContent }[];
  /** Already here (imported before, or edited, or deleted since): left alone. */
  skipped: number;
  /** Entries of the old file that are not usable tasks (no text). */
  invalid: number;
}

/** Reads the old file's text; null when it is not a 哞哞清单 store. */
export function parseLegacyStore(text: string): unknown[] | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const tasks = (data as { tasks?: unknown } | null)?.tasks;
  return Array.isArray(tasks) ? tasks : null;
}

const NAMESPACE = "moli-todo/legacy-import/v1:";

/** The new id for an old task: a fixed function of the old id, the same on every device. */
export async function legacyTaskId(legacyKey: string): Promise<string> {
  const bytes = new TextEncoder().encode(NAMESPACE + legacyKey);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const hex = Array.from(digest.slice(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  );
  return `legacy-${hex}`;
}

interface Old {
  id?: unknown;
  text?: unknown;
  done?: unknown;
  doneAt?: unknown;
  archived?: unknown;
  duration?: unknown;
}

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/**
 * Works out what to add. `knows` says whether an id exists here already (deleted tasks count);
 * new tasks go after `lastPosition`.
 */
export async function planLegacyImport(
  oldTasks: unknown[],
  knows: (id: string) => boolean,
  lastPosition: string | null
): Promise<ImportPlan> {
  const plan: ImportPlan = { items: [], skipped: 0, invalid: 0 };
  const seen = new Map<string, number>();
  let position = lastPosition;

  for (const [index, entry] of oldTasks.entries()) {
    const old = (typeof entry === "object" && entry !== null ? entry : {}) as Old;
    if (typeof old.text !== "string" || !old.text.trim()) {
      plan.invalid += 1;
      continue;
    }
    const rawId =
      typeof old.id === "string" || isNumber(old.id) ? String(old.id) : `index-${index}`;
    const count = (seen.get(rawId) ?? 0) + 1;
    seen.set(rawId, count);
    const id = await legacyTaskId(count === 1 ? rawId : `${rawId}#${count}`);
    if (knows(id)) {
      plan.skipped += 1;
      continue;
    }
    const done = old.done === true;
    position = positionAfter(position);
    plan.items.push({
      id,
      content: {
        text: old.text.trim().slice(0, MAX_TEXT_LENGTH),
        done,
        doneAt: done && isNumber(old.doneAt) && old.doneAt >= 0 ? Math.round(old.doneAt) : null,
        archived: done && old.archived === true,
        duration:
          isNumber(old.duration) && old.duration > 0
            ? Math.round(Math.min(old.duration, MAX_DURATION_MINUTES))
            : 0,
        position,
        deleted: false,
      },
    });
  }
  return plan;
}
