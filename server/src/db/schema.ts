import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
