import { z } from "zod";

// Everything a person keeps is a "record": a kind, an id the client made, and that kind's data. One sync
// interface carries all kinds (standard 009, 9.7): pull changes by cursor, push one record with the version it
// was based on.

export const MAX_TEXT_LENGTH = 2000;
export const MAX_CHANGES_PAGE = 500;
/** A single task is longer than this only by mistake (100 hours). */
export const MAX_DURATION_MINUTES = 100 * 60;
/** A focus session is longer than this only by mistake (24 hours). */
export const MAX_SESSION_SECONDS = 24 * 60 * 60;
export const MAX_INDENT = 3;
/** An uploaded cover, as a data URL, after the browser has shrunk it. */
export const MAX_COVER_LENGTH = 600_000;
/** Pictures one line can carry. */
export const MAX_IMAGES_PER_TASK = 9;
/** Covers she can upload; each is synced to every device, so keep them few. */
export const MAX_UPLOADED_COVERS = 6;
/** An uploaded picture file, after the browser has shrunk it. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const FILE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** Header every client sends: `<client>/<version>`, e.g. `todo-web/3.0.0`. */
export const CLIENT_HEADER = "x-moli-client";

export const RECORD_KINDS = ["task", "tag", "session", "timer", "settings", "cover"] as const;
export const recordKindSchema = z.enum(RECORD_KINDS);
export type RecordKind = z.infer<typeof recordKindSchema>;

/** Client-made ids: UUIDs, a tag's lower-cased name, or a fixed name for one-of-a-kind records. */
export const recordIdSchema = z.string().regex(/^[^\s/\\?#%]{1,64}$/u);
/** Order keys (see web/src/lib/position.ts): letters and digits, never ending in "0". */
export const positionSchema = z.string().regex(/^[0-9A-Za-z]{0,63}[1-9A-Za-z]$/);
/** A calendar day in Singapore time (standard 013), "YYYY-MM-DD". */
export const dayKeySchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);
export const hexColorSchema = z.string().regex(/^#[0-9a-f]{6}$/);
const timestamp = z.number().int().min(0);

export const HIGHLIGHTS = ["yellow", "red", "blue", "green", "purple"] as const;
export const highlightSchema = z.enum(HIGHLIGHTS);
export type Highlight = z.infer<typeof highlightSchema>;
/** "fill" paints behind the words like a marker pen; "underline" draws a coloured line under them. */
export const HIGHLIGHT_STYLES = ["fill", "underline"] as const;
export type HighlightStyle = (typeof HIGHLIGHT_STYLES)[number];

/** What starts a line: a box to tick (a to-do), or a dot or dash for a note that is never ticked. */
export const MARKS = ["box", "dot", "dash"] as const;
export type Mark = (typeof MARKS)[number];

/** Server-made ids of uploaded files (UUIDs). */
export const fileIdSchema = z.string().regex(/^[0-9a-f-]{36}$/);

/** One line of a day's list. `#words` in the text are its tags. `indent` only moves it right; it is not a subtask. */
export const taskDataSchema = z.object({
  day: dayKeySchema,
  text: z.string().max(MAX_TEXT_LENGTH),
  indent: z.number().int().min(0).max(MAX_INDENT),
  done: z.boolean(),
  doneAt: timestamp.nullable(),
  /** Minutes spent, typed in by hand; null when not given. */
  duration: z.number().int().min(0).max(MAX_DURATION_MINUTES).nullable(),
  highlight: highlightSchema.nullable(),
  position: positionSchema,
  /** Missing on lines written before notes existed: those are boxes. */
  mark: z.enum(MARKS).optional(),
  /** Missing means "fill". */
  highlightStyle: z.enum(HIGHLIGHT_STYLES).optional(),
  /** Pictures attached to the line, as ids from `POST /api/v2/files`. */
  images: z.array(fileIdSchema).max(MAX_IMAGES_PER_TASK).optional(),
});
export type TaskData = z.infer<typeof taskDataSchema>;

/** Settings for one tag; the id is the tag's name in lower case. Tags without a record use the theme colour. */
export const tagDataSchema = z.object({
  name: z.string().min(1).max(50),
  color: hexColorSchema.nullable(),
});
export type TagData = z.infer<typeof tagDataSchema>;

/** One finished stopwatch run. `seconds` leaves out pauses. */
export const sessionDataSchema = z.object({
  name: z.string().max(200),
  startedAt: timestamp,
  endedAt: timestamp,
  seconds: z.number().int().min(0).max(MAX_SESSION_SECONDS),
  day: dayKeySchema,
});
export type SessionData = z.infer<typeof sessionDataSchema>;

/** The stopwatch (id `current`), kept on the server so it keeps running across reloads and devices. */
export const timerDataSchema = z.object({
  name: z.string().max(200),
  /** When the run began; null when the stopwatch is not in use. */
  startedAt: timestamp.nullable(),
  /** Seconds counted before the last start. */
  accumulated: z.number().int().min(0).max(MAX_SESSION_SECONDS),
  /** When it was last started; null while paused or stopped. */
  runningSince: timestamp.nullable(),
});
export type TimerData = z.infer<typeof timerDataSchema>;

export const THEMES = ["system", "light", "dark"] as const;

/** Appearance (id `settings`). */
export const settingsDataSchema = z.object({
  accent: hexColorSchema.nullable(),
  theme: z.enum(THEMES),
  /**
   * A built-in cover's id, `u:<id>` for an uploaded one (a `cover` record), or "upload" for the first upload
   * (the record with id `cover`).
   */
  cover: z.string().min(1).max(40),
  /** The book's case; null or missing means the theme colour. */
  caseColor: hexColorSchema.nullable().optional(),
  /** Built-in covers she removed from the list. */
  hiddenCovers: z.array(z.string().min(1).max(40)).max(40).optional(),
});
export type SettingsData = z.infer<typeof settingsDataSchema>;

/** An uploaded cover picture (one record each), kept apart from settings so changing the theme does not resend it. */
export const coverDataSchema = z.object({
  image: z
    .string()
    .max(MAX_COVER_LENGTH)
    .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/),
});
export type CoverData = z.infer<typeof coverDataSchema>;

export const recordDataSchemas = {
  task: taskDataSchema,
  tag: tagDataSchema,
  session: sessionDataSchema,
  timer: timerDataSchema,
  settings: settingsDataSchema,
  cover: coverDataSchema,
} as const;

export interface RecordDataByKind {
  task: TaskData;
  tag: TagData;
  session: SessionData;
  timer: TimerData;
  settings: SettingsData;
  cover: CoverData;
}

/** What the server stores and returns. `version` goes up by one on every change. */
export const recordSchema = z.object({
  kind: recordKindSchema,
  id: recordIdSchema,
  data: z.unknown(),
  /** A deleted record stays as a marker so other devices do not bring it back (standard 009, 9.7.4). */
  deleted: z.boolean(),
  version: z.number().int().min(1),
});
export type SyncRecord = z.infer<typeof recordSchema>;

/** `PUT /api/v2/records/:kind/:id`. `baseVersion` is the version the change is based on: 0 to create. */
export const putRecordBodySchema = z.object({
  data: z.unknown(),
  deleted: z.boolean(),
  baseVersion: z.number().int().min(0),
});
export type PutRecordBody = z.infer<typeof putRecordBodySchema>;

/** `GET /api/v2/changes?cursor=&limit=` */
export const changesResponseSchema = z.object({
  records: z.array(recordSchema),
  /** Pass this back as `cursor` next time. */
  cursor: z.number().int().min(0),
  hasMore: z.boolean(),
});
export type ChangesResponse = z.infer<typeof changesResponseSchema>;

/** 200 answer of a successful PUT. */
export const putRecordResponseSchema = z.object({ record: recordSchema });

/** 409: someone else changed the record first; `record` is how the server has it now (null if it has none). */
export const conflictResponseSchema = z.object({
  error: z.object({ code: z.literal("conflict"), message: z.string() }),
  record: recordSchema.nullable(),
});
export type ConflictResponse = z.infer<typeof conflictResponseSchema>;

/** 200 answer of `POST /api/v2/files` (the body is the picture itself). */
export const fileResponseSchema = z.object({ id: fileIdSchema });
