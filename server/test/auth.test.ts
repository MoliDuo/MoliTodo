import { afterEach, describe, expect, it } from "vitest";
import { sessions, users } from "../src/db/schema.js";
import { createTestApp } from "../test-support/app.js";
import { ISSUER, WEB_CLIENT } from "../test-support/fake-issuer.js";

type Ctx = Awaited<ReturnType<typeof createTestApp>>;
let ctx: Ctx;
afterEach(async () => ctx?.app.close());

const NOW_SECONDS = Math.floor(Date.parse("2026-10-04T12:00:00Z") / 1000);

/** Starts a sign-in and returns what the browser would hold and what the identity service would send back. */
async function startLogin(c: Ctx) {
  const start = await c.app.inject({ method: "GET", url: "/auth/login" });
  const cookie = start.cookies.find((item) => item.name === "__Host-todo_login")!.value;
  return { start, cookie, ...c.issuer.approve(String(start.headers.location)) };
}

describe("sign-in start", () => {
  it("redirects to the identity service with PKCE, state and nonce", async () => {
    ctx = await createTestApp();
    const res = await ctx.app.inject({ method: "GET", url: "/auth/login" });
    expect(res.statusCode).toBe(302);
    const url = new URL(String(res.headers.location));
    expect(url.origin).toBe(ISSUER);
    expect(url.searchParams.get("client_id")).toBe(WEB_CLIENT);
    expect(url.searchParams.get("redirect_uri")).toBe("https://todo.example.com/auth/callback");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toBe("openid profile email groups");
    expect(url.searchParams.get("state")!.length).toBeGreaterThanOrEqual(16);
    expect(url.searchParams.get("nonce")).toBeTruthy();
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
  });

  it("uses a different state every time", async () => {
    ctx = await createTestApp();
    const first = await startLogin(ctx);
    const second = await startLogin(ctx);
    expect(first.state).not.toBe(second.state);
  });
});

describe("callback", () => {
  it("signs the user in, lower-casing the username, and returns them to where they were going", async () => {
    ctx = await createTestApp();
    const { callback, session } = await ctx.signIn("Alice", "/tasks?x=1");
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe("/tasks?x=1");
    expect(session).toBeDefined();
    const user = ctx.db.select().from(users).get();
    expect(user?.username).toBe("alice");
    expect(user?.email).toBe("Alice@example.com");
  });

  it("sets a hardened cookie and keeps no identity-service token in the session", async () => {
    ctx = await createTestApp();
    const { session } = await ctx.signIn();
    expect(session).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax", path: "/" });
    expect(session?.domain).toBeUndefined();
    const stored = ctx.db.select().from(sessions).get();
    expect(Object.keys(stored ?? {}).sort()).toEqual([
      "createdAt",
      "expiresAt",
      "idHash",
      "lastSeenAt",
      "username",
    ]);
    expect(stored?.idHash).not.toBe(session?.value);
  });

  it("refuses a tampered state", async () => {
    ctx = await createTestApp();
    const { cookie, code, state } = await startLogin(ctx);
    const res = await ctx.app.inject({
      method: "GET",
      url: `/auth/callback?code=${code}&state=${state}x`,
      cookies: { "__Host-todo_login": cookie },
    });
    expect(res.statusCode).toBe(400);
    expect(res.cookies.find((c) => c.name === "__Host-todo_session")).toBeUndefined();
  });

  it("refuses a callback from a browser that did not start the sign-in", async () => {
    ctx = await createTestApp();
    const { code, state } = await startLogin(ctx);
    const res = await ctx.app.inject({
      method: "GET",
      url: `/auth/callback?code=${code}&state=${state}`,
    });
    expect(res.statusCode).toBe(400);
  });

  it("lets a state be used only once", async () => {
    ctx = await createTestApp();
    const { cookie, code, state } = await startLogin(ctx);
    const url = `/auth/callback?code=${code}&state=${state}`;
    expect(
      (await ctx.app.inject({ method: "GET", url, cookies: { "__Host-todo_login": cookie } }))
        .statusCode
    ).toBe(302);
    const replay = await ctx.app.inject({
      method: "GET",
      url,
      cookies: { "__Host-todo_login": cookie },
    });
    expect(replay.statusCode).toBe(400);
  });

  it("refuses a sign-in that took longer than 10 minutes", async () => {
    ctx = await createTestApp();
    const { cookie, code, state } = await startLogin(ctx);
    ctx.clock.now += 11 * 60_000;
    const res = await ctx.app.inject({
      method: "GET",
      url: `/auth/callback?code=${code}&state=${state}`,
      cookies: { "__Host-todo_login": cookie },
    });
    expect(res.statusCode).toBe(400);
  });

  it.each([
    ["a wrong nonce", { nonce: "someone-elses" }],
    ["a wrong audience", { aud: "moli-other" }],
    ["a wrong issuer", { iss: "https://evil.example.com" }],
    ["an expired token", { exp: NOW_SECONDS - 3600 }],
    ["a token issued over 5 minutes ago", { iat: NOW_SECONDS - 600 }],
    ["no username", { preferred_username: undefined }],
  ])("refuses %s", async (_name, override) => {
    ctx = await createTestApp();
    ctx.issuer.state.override = override;
    const { callback, session } = await ctx.signIn();
    expect(callback.statusCode).toBe(400);
    expect(session).toBeUndefined();
  });

  it("refuses a token signed with an unknown key", async () => {
    ctx = await createTestApp();
    ctx.issuer.state.signWithRogueKey = true;
    const { callback, session } = await ctx.signIn();
    expect(callback.statusCode).toBe(400);
    expect(session).toBeUndefined();
  });

  it("refuses a failed code exchange", async () => {
    ctx = await createTestApp();
    const { cookie, state } = await startLogin(ctx);
    const res = await ctx.app.inject({
      method: "GET",
      url: `/auth/callback?code=never-issued&state=${state}`,
      cookies: { "__Host-todo_login": cookie },
    });
    expect(res.statusCode).toBe(400);
  });

  it("does not follow a next that leaves the site or points at our own endpoints", async () => {
    ctx = await createTestApp();
    for (const next of [
      "//evil.example.com",
      "https://evil.example.com",
      "/auth/login",
      "/api/v1/me",
      "\\evil",
    ]) {
      const { callback } = await ctx.signIn("alice", next);
      expect(callback.headers.location).toBe("/");
    }
  });
});

describe("sessions", () => {
  it("lets a signed-in browser read /api/v1/me", async () => {
    ctx = await createTestApp();
    const { cookie } = await ctx.signIn();
    const res = await ctx.app.inject({ method: "GET", url: "/api/v1/me", cookies: cookie });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      username: "alice",
      name: "alice name",
      email: "alice@example.com",
      via: "session",
    });
  });

  it("answers 401 with JSON when nobody is signed in", async () => {
    ctx = await createTestApp();
    const res = await ctx.app.inject({ method: "GET", url: "/api/v1/me" });
    expect(res.statusCode).toBe(401);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.json()).toEqual({ error: { code: "unauthorized", message: "Sign in required" } });
  });

  it("rejects an unknown cookie and an expired session", async () => {
    ctx = await createTestApp();
    const forged = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/me",
      cookies: { "__Host-todo_session": "x".repeat(43) },
    });
    expect(forged.statusCode).toBe(401);
    const { cookie } = await ctx.signIn();
    ctx.clock.now += 31 * 24 * 60 * 60 * 1000;
    const expired = await ctx.app.inject({ method: "GET", url: "/api/v1/me", cookies: cookie });
    expect(expired.statusCode).toBe(401);
  });

  it("slides the expiry while the user keeps using it", async () => {
    ctx = await createTestApp();
    const { cookie } = await ctx.signIn();
    for (let step = 0; step < 4; step += 1) {
      ctx.clock.now += 20 * 24 * 60 * 60 * 1000;
      const res = await ctx.app.inject({ method: "GET", url: "/api/v1/me", cookies: cookie });
      expect(res.statusCode).toBe(200);
    }
  });

  it("gives the same person the same owner from two sign-ins", async () => {
    ctx = await createTestApp();
    await ctx.signIn("Alice");
    await ctx.signIn("ALICE");
    expect(ctx.db.select().from(users).all()).toHaveLength(1);
  });
});

describe("Authorization header", () => {
  it("does not sign anyone in: a Bearer token is not a way in", async () => {
    ctx = await createTestApp();
    const { code, state, cookie } = await startLogin(ctx);
    const callback = await ctx.app.inject({
      method: "GET",
      url: `/auth/callback?code=${code}&state=${state}`,
      cookies: { "__Host-todo_login": cookie },
    });
    const idToken = await ctx.issuer.lastIdToken();
    expect(callback.statusCode).toBe(302);
    for (const authorization of [`Bearer ${idToken}`, "Bearer garbage", "Basic abc"]) {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/v1/me",
        headers: { authorization },
      });
      expect(res.statusCode).toBe(401);
    }
  });

  it("leaves the session cookie in charge when a header is also present", async () => {
    ctx = await createTestApp();
    const { cookie } = await ctx.signIn("alice");
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/me",
      cookies: cookie,
      headers: { authorization: "Bearer garbage" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ username: "alice", via: "session" });
  });

  it("does not accept an ID token as a browser session", async () => {
    ctx = await createTestApp();
    await ctx.signIn("bob");
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/me",
      cookies: { "__Host-todo_session": await ctx.issuer.lastIdToken() },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("ID token verification", () => {
  it("refuses a token using an algorithm outside the allow list", async () => {
    ctx = await createTestApp();
    ctx.issuer.state.signWithAlg = "RS384";
    const { callback, session } = await ctx.signIn();
    expect(callback.statusCode).toBe(400);
    expect(session).toBeUndefined();
  });

  it("refreshes the key set for an unknown key at most once a minute (no amplification)", async () => {
    ctx = await createTestApp();
    const fetches = () => ctx.issuer.requests.filter((path) => path === "/jwks.json").length;
    expect((await ctx.signIn()).callback.statusCode).toBe(302);
    expect(fetches()).toBe(1);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      ctx.issuer.state.signWithRogueKey = true;
      expect((await ctx.signIn()).callback.statusCode).toBe(400);
    }
    expect(fetches()).toBe(1);
    ctx.clock.now += 2 * 60_000;
    ctx.issuer.state.signWithRogueKey = true;
    expect((await ctx.signIn()).callback.statusCode).toBe(400);
    expect(fetches()).toBe(2);
  });

  it("picks up a rotated signing key by refreshing the key set", async () => {
    ctx = await createTestApp();
    expect((await ctx.signIn()).callback.statusCode).toBe(302);
    await ctx.issuer.state.rotate();
    ctx.clock.now += 2 * 60_000;
    expect((await ctx.signIn()).callback.statusCode).toBe(302);
  });
});

describe("write protection", () => {
  it("refuses a cookie-authenticated write from another origin", async () => {
    ctx = await createTestApp({}, (app) => {
      app.post("/api/v1/_probe", async () => ({ ok: true }));
    });
    const { cookie } = await ctx.signIn();
    const none = await ctx.app.inject({ method: "POST", url: "/api/v1/_probe", cookies: cookie });
    const evil = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/_probe",
      cookies: cookie,
      headers: { origin: "https://evil.example.com" },
    });
    const own = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/_probe",
      cookies: cookie,
      headers: { origin: "https://todo.example.com" },
    });
    expect([none.statusCode, evil.statusCode, own.statusCode]).toEqual([403, 403, 200]);
  });
});

describe("healthz and headers", () => {
  it("answers ok with the version, without signing in", async () => {
    ctx = await createTestApp();
    const res = await ctx.app.inject({ method: "GET", url: "/healthz" });
    expect(res.json()).toEqual({ ok: true, version: "test-version" });
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  });
});

describe("errors", () => {
  it("answers 500 JSON without leaking the cause", async () => {
    ctx = await createTestApp({}, (app) => {
      app.get("/api/v1/_boom", async () => {
        throw new Error("secret detail");
      });
    });
    const res = await ctx.app.inject({ method: "GET", url: "/api/v1/_boom" });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain("secret detail");
    expect(res.json()).toEqual({ error: { code: "internal", message: "Something went wrong" } });
  });

  it("answers 400 JSON for a bad request body", async () => {
    ctx = await createTestApp({}, (app) => {
      app.post("/api/v1/_json", async (request) => request.body);
    });
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/_json",
      headers: { "content-type": "application/json" },
      payload: "{broken",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("bad_request");
  });
});
