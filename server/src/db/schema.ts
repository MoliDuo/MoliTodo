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
 * Everything a person keeps (tasks, tags, focus sessions, the stopwatch, settings), one row per record. `data` is
 * the kind's JSON, checked against `shared/records.ts` on every write. A deleted record stays as a marker
 * (`deleted`) so other devices drop it too (standard 009, 9.7.4). `seq` is a per-owner counter that goes up on
 * every change; it is the cursor clients pull by.
 */
export const records = sqliteTable(
  "records",
  {
    owner: text("owner").notNull(),
    kind: text("kind").notNull(),
    id: text("id").notNull(),
    data: text("data").notNull(),
    deleted: integer("deleted", { mode: "boolean" }).notNull(),
    version: integer("version").notNull(),
    seq: integer("seq").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.owner, table.kind, table.id] }),
    index("records_owner_seq").on(table.owner, table.seq),
  ]
);
