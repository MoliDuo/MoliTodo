import { createHash } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { oidcLogins, sessions, users } from "../db/schema.js";
import { randomToken, type Identity } from "./oidc.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** A sign-in attempt lives at most 10 minutes (standard 008, 8.5.2). */
export const LOGIN_TTL_MS = 10 * MINUTE;

const hashId = (id: string) => createHash("sha256").update(id).digest("hex");

export interface LoginAttempt {
  state: string;
  nonce: string;
  codeVerifier: string;
  next: string;
}

/** Sign-in attempts in progress, kept only on the server and deleted when used. */
export class LoginStore {
  constructor(
    private readonly db: Db,
    private readonly now: () => number
  ) {}

  create(next: string): LoginAttempt {
    this.db.delete(oidcLogins).where(lt(oidcLogins.expiresAt, this.now())).run();
    const attempt = {
      state: randomToken(24),
      nonce: randomToken(24),
      codeVerifier: randomToken(48),
      next,
    };
    this.db
      .insert(oidcLogins)
      .values({ ...attempt, expiresAt: this.now() + LOGIN_TTL_MS })
      .run();
    return attempt;
  }

  /** Returns the attempt once; a second call, or an expired one, returns null. */
  consume(state: string): LoginAttempt | null {
    const row = this.db.select().from(oidcLogins).where(eq(oidcLogins.state, state)).get();
    if (!row) return null;
    this.db.delete(oidcLogins).where(eq(oidcLogins.state, state)).run();
    if (row.expiresAt < this.now()) return null;
    return { state: row.state, nonce: row.nonce, codeVerifier: row.codeVerifier, next: row.next };
  }
}

export interface SessionUser {
  username: string;
  name: string | null;
  email: string | null;
}

/** Browser sessions: a random cookie value, only its hash is stored; sliding expiry (8.5.4). */
export class SessionStore {
  constructor(
    private readonly db: Db,
    private readonly now: () => number,
    private readonly lifetimeMs: number
  ) {}

  /** Records the user (first sign-in creates the row, 8.5.5) and starts a session for them. */
  start(identity: Identity): { id: string; expiresAt: number } {
    const now = this.now();
    this.db
      .insert(users)
      .values({
        username: identity.username,
        name: identity.name,
        email: identity.email,
        createdAt: now,
        lastLoginAt: now,
      })
      .onConflictDoUpdate({
        target: users.username,
        set: { name: identity.name, email: identity.email, lastLoginAt: now },
      })
      .run();
    this.db.delete(sessions).where(lt(sessions.expiresAt, now)).run();
    const id = randomToken(32);
    const expiresAt = now + this.lifetimeMs;
    this.db
      .insert(sessions)
      .values({
        idHash: hashId(id),
        username: identity.username,
        createdAt: now,
        lastSeenAt: now,
        expiresAt,
      })
      .run();
    return { id, expiresAt };
  }

  /** The user of a live session, or null. Extends it when it was last touched over an hour ago. */
  find(id: string): SessionUser | null {
    const now = this.now();
    const idHash = hashId(id);
    const row = this.db
      .select({
        username: users.username,
        name: users.name,
        email: users.email,
        expiresAt: sessions.expiresAt,
        lastSeenAt: sessions.lastSeenAt,
      })
      .from(sessions)
      .innerJoin(users, eq(users.username, sessions.username))
      .where(eq(sessions.idHash, idHash))
      .get();
    if (!row || row.expiresAt <= now) return null;
    if (now - row.lastSeenAt > HOUR) {
      this.db
        .update(sessions)
        .set({ lastSeenAt: now, expiresAt: now + this.lifetimeMs })
        .where(eq(sessions.idHash, idHash))
        .run();
    }
    return { username: row.username, name: row.name, email: row.email };
  }

  end(id: string): void {
    this.db
      .delete(sessions)
      .where(eq(sessions.idHash, hashId(id)))
      .run();
  }
}
