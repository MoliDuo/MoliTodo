import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** One row per person who has signed in (standard 008, 8.5.5). The key is `preferred_username`, lower-cased. */
export const users = sqliteTable("users", {
  username: text("username").primaryKey(),
  name: text("name"),
  email: text("email"),
  createdAt: integer("created_at").notNull(),
  lastLoginAt: integer("last_login_at").notNull(),
});

/** Browser sessions. Only a hash of the cookie value is stored; no Authelia tokens (8.5.4). */
export const sessions = sqliteTable("sessions", {
  idHash: text("id_hash").primaryKey(),
  username: text("username")
    .notNull()
    .references(() => users.username),
  createdAt: integer("created_at").notNull(),
  lastSeenAt: integer("last_seen_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

/** A sign-in in progress: kept server-side for at most 10 minutes, deleted when used (8.5.2). */
export const oidcLogins = sqliteTable("oidc_logins", {
  state: text("state").primaryKey(),
  nonce: text("nonce").notNull(),
  codeVerifier: text("code_verifier").notNull(),
  next: text("next").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

/**
 * One row per task. A deleted task stays as a marker (`deleted`) so other devices drop it too (standard 009, 9.7.4).
 * `seq` is a per-owner counter that goes up on every change; it is the cursor clients pull by.
 */
export const tasks = sqliteTable(
  "tasks",
  {
    owner: text("owner").notNull(),
    id: text("id").notNull(),
    text: text("text").notNull(),
    done: integer("done", { mode: "boolean" }).notNull(),
    doneAt: integer("done_at"),
    archived: integer("archived", { mode: "boolean" }).notNull(),
    duration: integer("duration").notNull(),
    position: text("position").notNull(),
    deleted: integer("deleted", { mode: "boolean" }).notNull(),
    version: integer("version").notNull(),
    seq: integer("seq").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.owner, table.id] }),
    index("tasks_owner_seq").on(table.owner, table.seq),
  ]
);
