import { z } from "zod";
import { emptyState, type SyncState } from "@shared/sync";
import { taskContentSchema, taskSchema } from "@shared/tasks";
import type { DataFile, Platform } from "./platform";

const boundsSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

/** `settings.json`. Only ever grows new fields (standard 009, 9.6); unknown fields are ignored. */
export const settingsSchema = z.object({
  /** Kept in this file, not in a keychain (standard 008, 8.7.5). The ID token never is. */
  refreshToken: z.string().nullable().default(null),
  /** Who is signed in, for display. */
  account: z.object({ username: z.string(), name: z.string().nullable() }).nullable().default(null),
  bounds: boundsSchema.nullable().default(null),
  collapsed: z.boolean().default(false),
  permanentTop: z.boolean().default(true),
});
export type Settings = z.infer<typeof settingsSchema>;
export const defaultSettings = (): Settings => settingsSchema.parse({});

const syncStateSchema = z.object({
  tasks: z.record(z.string(), taskSchema),
  pending: z.record(
    z.string(),
    z.object({
      content: taskContentSchema,
      baseVersion: z.number().int().min(0),
      quiet: z.boolean().optional(),
    })
  ),
  cursor: z.number().int().min(0),
  conflicts: z.array(
    z.object({
      id: z.string(),
      discarded: taskContentSchema,
      at: z.number(),
      reason: z.enum(["conflict", "rejected"]),
    })
  ),
  lastSyncAt: z.number().nullable(),
});

/** `state.json`: the copy of the tasks, the changes not sent yet, and the sync cursor. */
const stateFileSchema = z.object({
  /** Whose tasks these are; another person signing in on this machine starts from an empty copy. */
  owner: z.string().nullable().default(null),
  sync: syncStateSchema,
});
export interface StateFile {
  owner: string | null;
  sync: SyncState;
}

async function load<T>(
  platform: Platform,
  name: DataFile,
  parse: (text: string) => T,
  fallback: () => T
): Promise<T> {
  let text: string | null;
  try {
    text = await platform.readFile(name);
  } catch {
    return fallback();
  }
  if (text === null) return fallback();
  try {
    return parse(text);
  } catch {
    // Keep the unreadable file for recovery instead of overwriting it with the next save.
    await platform.quarantineFile(name).catch(() => undefined);
    return fallback();
  }
}

export const loadSettings = (platform: Platform): Promise<Settings> =>
  load(
    platform,
    "settings.json",
    (text) => settingsSchema.parse(JSON.parse(text)),
    defaultSettings
  );

export const loadState = (platform: Platform): Promise<StateFile> =>
  load(
    platform,
    "state.json",
    (text) => stateFileSchema.parse(JSON.parse(text)) as StateFile,
    () => ({ owner: null, sync: emptyState() })
  );

/**
 * Writes a file soon after it changed, one write at a time, and always the latest content: changes that come
 * while a write is running are folded into one more write afterwards.
 */
export function createSaver(
  write: (text: string) => Promise<void>,
  delayMs: number,
  onError: (error: unknown) => void
) {
  let latest: (() => string) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> = Promise.resolve();

  const run = () => {
    timer = null;
    const get = latest;
    latest = null;
    if (!get) return;
    running = running.then(() => write(get())).catch(onError);
  };

  return {
    /** Remember to save what `get()` returns when the delay is over. */
    schedule(get: () => string) {
      latest = get;
      timer ??= setTimeout(run, delayMs);
    },
    /** Save now, and resolve when everything is on disk. */
    async flush() {
      if (timer) clearTimeout(timer);
      run();
      await running;
    },
  };
}
