import { afterEach, describe, expect, it } from "vitest";
import { createSession } from "./session";
import { createMemoryPlatform, createWorld, idToken } from "./test-support";

const now = () => Date.now();
const sleep = async () => undefined;

async function start(files: Parameters<typeof createMemoryPlatform>[1] = {}) {
  const world = createWorld();
  const platform = createMemoryPlatform(world, files);
  const session = await createSession({ platform, now, sleep });
  return { world, platform, session };
}

const signIn = async (session: Awaited<ReturnType<typeof start>>["session"]) => {
  const login = await session.auth.start();
  await session.tokens.accept(await session.auth.waitForApproval(login));
  await session.completeSignIn();
};

afterEach(() => undefined);

describe("createSession", () => {
  it("starts signed out with an empty list, and a sync then asks to sign in without calling the server", async () => {
    const { session, world } = await start();
    expect(session.tokens.signedIn).toBe(false);
    expect(session.store.engine.all()).toEqual([]);
    session.store.engine.add("离线写的");
    expect((await session.store.engine.sync()).status).toBe("auth");
    expect(world.server.requests).toEqual([]);
    expect(session.store.engine.list()).toHaveLength(1);
  });

  it("signs in, learns who it is, saves the refresh token, and then syncs with the ID token", async () => {
    const { session, world, platform } = await start();
    session.store.engine.add("先写下来");
    await signIn(session);
    expect(session.tokens.signedIn).toBe(true);
    expect(session.settings().account).toEqual({ username: "alice", name: "Alice" });
    expect(JSON.parse(platform.files["settings.json"] ?? "{}").refreshToken).toBe("refresh-1");
    world.server.requireAuthorization = `Bearer ${await session.tokens.idTokenForRequest()}`;
    expect((await session.store.engine.sync()).status).toBe("idle");
    expect(world.server.rows.size).toBe(1);
    const sent = world.server.requests.find((r) => r.method === "PUT");
    expect(sent?.headers["x-moli-client"]).toMatch(/^todo-desktop\//);
  });

  it("keeps working from the files after a restart: tasks, queue, and sign-in", async () => {
    const first = await start();
    first.session.store.engine.add("跨重启");
    await signIn(first.session);
    await first.session.flush();

    const second = await createSession({
      platform: createMemoryPlatform(first.world, first.platform.files),
      now,
      sleep,
    });
    expect(second.tokens.signedIn).toBe(true);
    expect(second.store.engine.list().map((t) => t.text)).toEqual(["跨重启"]);
    expect(Object.keys(second.store.engine.getState().pending)).toHaveLength(1);
    expect(second.settings().account?.username).toBe("alice");
  });

  it("refreshes the ID token with the saved refresh token after a restart", async () => {
    const files = { "settings.json": JSON.stringify({ refreshToken: "saved" }) };
    const { session, world } = await start(files);
    expect(await session.tokens.idTokenForRequest()).toContain(".");
    expect(world.identity.refreshes).toBe(1);
  });

  it("goes back to signed out, keeping the tasks, when the refresh token is refused", async () => {
    const files = {
      "settings.json": JSON.stringify({
        refreshToken: "revoked",
        account: { username: "alice", name: null },
      }),
      "state.json": JSON.stringify({
        owner: "alice",
        sync: {
          tasks: {},
          pending: {
            "task-0001": {
              content: {
                text: "留着",
                done: false,
                doneAt: null,
                archived: false,
                duration: 0,
                position: "V",
                deleted: false,
              },
              baseVersion: 0,
            },
          },
          cursor: 0,
          conflicts: [],
          lastSyncAt: null,
        },
      }),
    };
    const { session, world, platform } = await start(files);
    world.identity.refreshFails = 400;
    expect((await session.store.engine.sync()).status).toBe("auth");
    expect(session.tokens.signedIn).toBe(false);
    expect(JSON.parse(platform.files["settings.json"] ?? "{}").refreshToken).toBeNull();
    expect(session.store.engine.list().map((t) => t.text)).toEqual(["留着"]);
  });

  it("treats an unreachable sign-in service as offline, and stays signed in", async () => {
    const { session, world } = await start({
      "settings.json": JSON.stringify({ refreshToken: "ok" }),
    });
    world.identity.down = true;
    session.store.engine.add("x");
    expect((await session.store.engine.sync()).status).toBe("offline");
    expect(session.tokens.signedIn).toBe(true);
  });

  it("starts from an empty copy when someone else signs in, and keeps the copy for the same person", async () => {
    const owned = {
      "state.json": JSON.stringify({
        owner: "bob",
        sync: {
          tasks: {
            "task-0001": {
              id: "task-0001",
              text: "bob 的",
              done: false,
              doneAt: null,
              archived: false,
              duration: 0,
              position: "V",
              deleted: false,
              version: 1,
            },
          },
          pending: {},
          cursor: 1,
          conflicts: [],
          lastSyncAt: 1,
        },
      }),
    };
    const other = await start(owned);
    await signIn(other.session);
    expect(other.session.store.engine.all()).toEqual([]);

    const same = await start({
      "state.json": (owned["state.json"] ?? "").replace('"bob"', '"alice"'),
    });
    await signIn(same.session);
    expect(same.session.store.engine.all().map((t) => t.text)).toEqual(["bob 的"]);
  });

  it("fails sign-in completion when the server does not accept the token", async () => {
    const { session, world } = await start();
    world.server.fail = 500;
    const login = await session.auth.start();
    await session.tokens.accept(await session.auth.waitForApproval(login));
    await expect(session.completeSignIn()).rejects.toThrow();
  });

  it("signs out, keeping or deleting the local tasks", async () => {
    const keep = await start();
    keep.session.store.engine.add("保留");
    await signIn(keep.session);
    await keep.session.signOut({ clearLocal: false });
    expect(keep.session.tokens.signedIn).toBe(false);
    expect(keep.session.settings().account).toBeNull();
    expect(keep.session.store.engine.list()).toHaveLength(1);

    const clear = await start();
    clear.session.store.engine.add("删除");
    await signIn(clear.session);
    await clear.session.signOut({ clearLocal: true });
    expect(clear.session.store.engine.all()).toEqual([]);
    await clear.session.flush();
    expect(JSON.parse(clear.platform.files["state.json"] ?? "{}").owner).toBeNull();
  });

  it("changes settings and saves them", async () => {
    const { session, platform } = await start();
    session.updateSettings({ collapsed: true, bounds: { x: 1, y: 2, width: 300, height: 400 } });
    await session.flush();
    expect(JSON.parse(platform.files["settings.json"] ?? "{}")).toMatchObject({
      collapsed: true,
      bounds: { x: 1, y: 2, width: 300, height: 400 },
    });
  });

  it("reports a file that cannot be saved", async () => {
    const world = createWorld();
    const platform = createMemoryPlatform(world);
    platform.failWrites = true;
    const errors: unknown[] = [];
    const session = await createSession({ platform, now, sleep, onError: (e) => errors.push(e) });
    session.store.engine.add("x");
    await session.flush();
    expect(errors.length).toBeGreaterThan(0);
  });

  it("uses the clock it is given for token expiry", async () => {
    const world = createWorld();
    const platform = createMemoryPlatform(world, {
      "settings.json": JSON.stringify({ refreshToken: "r" }),
    });
    let time = Date.now();
    const session = await createSession({ platform, now: () => time, sleep });
    await session.tokens.idTokenForRequest();
    await session.tokens.idTokenForRequest();
    expect(world.identity.refreshes).toBe(1);
    time += 2 * 3600_000;
    await session.tokens.idTokenForRequest();
    expect(world.identity.refreshes).toBe(2);
    expect(idToken(1)).toContain(".");
  });
});
