import { describe, expect, it } from "vitest";
import { createHttpTransport } from "./http-transport";
import { SyncEngine, SyncError, type Transport } from "./sync";
import { createFakeApi } from "../test-support/fake-api";
import type { TagData } from "@shared/records";

const tag = (name: string, color: string | null = null): TagData => ({ name, color });

function device(api = createFakeApi(), now = () => 1_000) {
  const transport = createHttpTransport({ client: "todo-web/3.0.0", fetch: api.fetch });
  return { api, engine: new SyncEngine({ transport, now }) };
}

describe("SyncEngine editing", () => {
  it("shows staged records right away, by kind", () => {
    const { engine } = device();
    engine.put("tag", "a", tag("a"));
    engine.put("tag", "b", tag("b"));
    engine.put("settings", "a", { accent: null, theme: "system", cover: "monet" });
    expect(
      engine
        .all("tag")
        .map((t) => t.id)
        .sort()
    ).toEqual(["a", "b"]);
    expect(engine.get("tag", "a")).toMatchObject({ data: tag("a"), version: 0, unsynced: true });
    expect(engine.all("settings")).toHaveLength(1);
    expect(engine.get("tag", "missing")).toBeNull();
  });

  it("merges patches and ignores patches to records it does not show", () => {
    const { engine } = device();
    engine.put("tag", "a", tag("a"));
    engine.update("tag", "a", { color: "#123456" });
    engine.update("tag", "zzz", { color: "#123456" });
    expect(engine.get("tag", "a")?.data).toEqual(tag("a", "#123456"));
    expect(engine.get("tag", "zzz")).toBeNull();
  });

  it("removes records and ignores removing what is not there", () => {
    const { engine } = device();
    engine.put("tag", "a", tag("a"));
    engine.remove("tag", "a");
    engine.remove("tag", "a");
    engine.remove("tag", "never");
    expect(engine.get("tag", "a")).toBeNull();
    expect(engine.all("tag")).toEqual([]);
  });
});

describe("SyncEngine sync", () => {
  it("sends changes, pulls other devices' changes, and marks itself loaded", async () => {
    const { api, engine } = device();
    api.remote("tag", "remote", tag("remote"));
    engine.put("tag", "local", tag("local"));
    expect(engine.getState().loaded).toBe(false);
    const outcome = await engine.sync();
    expect(outcome).toEqual({ status: "idle", conflicts: [] });
    expect(api.data("tag", "local")).toEqual(tag("local"));
    expect(engine.get("tag", "remote")).toMatchObject({ unsynced: false, version: 1 });
    expect(engine.getState()).toMatchObject({ loaded: true, lastSyncAt: 1_000, pending: {} });
  });

  it("sends deletions as markers that other devices pick up", async () => {
    const api = createFakeApi();
    const a = device(api).engine;
    const b = device(api).engine;
    a.put("tag", "x", tag("x"));
    await a.sync();
    await b.sync();
    expect(b.get("tag", "x")).not.toBeNull();
    a.remove("tag", "x");
    await a.sync();
    await b.sync();
    expect(b.get("tag", "x")).toBeNull();
  });

  it("keeps the server's version on a conflict and remembers what was dropped", async () => {
    const api = createFakeApi();
    const a = device(api).engine;
    const b = device(api).engine;
    a.put("tag", "x", tag("x"));
    await a.sync();
    await b.sync();
    a.update("tag", "x", { color: "#111111" });
    b.update("tag", "x", { color: "#222222" });
    await a.sync();
    const outcome = await b.sync();
    expect(outcome.conflicts).toHaveLength(1);
    expect(b.get("tag", "x")?.data.color).toBe("#111111");
    const [conflict] = b.getState().conflicts;
    expect(conflict).toMatchObject({ kind: "tag", id: "x", reason: "conflict" });
    b.dismissConflict(conflict!);
    expect(b.getState().conflicts).toEqual([]);
  });

  it("drops a record the server never had when the conflict says so", async () => {
    const calls: string[] = [];
    const transport: Transport = {
      put: async () => {
        calls.push("put");
        return { kind: "conflict", record: null };
      },
      changes: async (cursor) => ({ records: [], cursor, hasMore: false }),
    };
    const engine = new SyncEngine({ transport });
    engine.put("tag", "x", tag("x"));
    await engine.sync();
    expect(engine.get("tag", "x")).toBeNull();
    expect(calls).toEqual(["put"]);
  });

  it("drops a change the server rejects and carries on with the rest", async () => {
    let n = 0;
    const transport: Transport = {
      put: async (kind, id, body) => {
        n += 1;
        if (id === "bad") throw new SyncError("rejected");
        return { kind: "ok", record: { kind, id, data: body.data, deleted: false, version: 1 } };
      },
      changes: async (cursor) => ({ records: [], cursor, hasMore: false }),
    };
    const engine = new SyncEngine({ transport });
    engine.put("tag", "bad", tag("bad"));
    engine.put("tag", "good", tag("good"));
    const outcome = await engine.sync();
    expect(n).toBe(2);
    expect(outcome.conflicts.map((c) => c.reason)).toEqual(["rejected"]);
    expect(engine.get("tag", "good")?.unsynced).toBe(false);
  });

  it("keeps changes when offline, signed out or outdated, and reports why", async () => {
    for (const [fail, status] of [
      ["network", "offline"],
      [500, "offline"],
      [401, "auth"],
      [426, "upgrade"],
    ] as const) {
      const { api, engine } = device();
      api.fail = fail;
      engine.put("tag", "x", tag("x"));
      expect((await engine.sync()).status).toBe(status);
      expect(engine.getStatus()).toBe(status);
      expect(engine.get("tag", "x")?.unsynced).toBe(true);
    }
  });

  it("treats an unexpected answer as offline", async () => {
    const transport: Transport = {
      put: async () => {
        throw new Error("boom");
      },
      changes: async (cursor) => ({ records: [], cursor, hasMore: false }),
    };
    const engine = new SyncEngine({ transport });
    engine.put("tag", "x", tag("x"));
    expect((await engine.sync()).status).toBe("offline");
  });

  it("keeps an edit made while its earlier version was being sent", async () => {
    const api = createFakeApi();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const slowFetch = (async (...args: Parameters<typeof fetch>) => {
      await gate;
      return api.fetch(...args);
    }) as typeof fetch;
    const engine = new SyncEngine({
      transport: createHttpTransport({ client: "todo-web/3.0.0", fetch: slowFetch }),
    });
    engine.put("tag", "x", tag("x"));
    const running = engine.sync();
    engine.update("tag", "x", { color: "#333333" });
    const joined = engine.sync();
    release();
    await running;
    await joined;
    expect(api.data("tag", "x")).toEqual(tag("x", "#333333"));
    expect(engine.getState().pending).toEqual({});
  });

  it("pulls page after page and ignores older copies", async () => {
    const pages = [
      {
        records: [{ kind: "tag" as const, id: "a", data: tag("a"), deleted: false, version: 2 }],
        cursor: 1,
        hasMore: true,
      },
      {
        records: [{ kind: "tag" as const, id: "a", data: tag("old"), deleted: false, version: 1 }],
        cursor: 2,
        hasMore: false,
      },
    ];
    const transport: Transport = {
      put: async () => ({ kind: "conflict", record: null }),
      changes: async () => pages.shift()!,
    };
    const engine = new SyncEngine({ transport });
    await engine.sync();
    expect(engine.get("tag", "a")?.data.name).toBe("a");
    expect(engine.getState().cursor).toBe(2);
  });
});

describe("http transport", () => {
  it("sends the client header and encodes ids", async () => {
    const { api, engine } = device();
    engine.put("tag", "阅读", tag("阅读"));
    await engine.sync();
    const put = api.requests.find((r) => r.method === "PUT")!;
    expect(put.url).toBe(`/api/v2/records/tag/${encodeURIComponent("阅读")}`);
    expect(put.headers["x-moli-client"]).toBe("todo-web/3.0.0");
  });

  it("turns odd answers into offline or rejected", async () => {
    const answers: [number, unknown, string][] = [
      [200, { nope: 1 }, "offline"],
      [409, { nope: 1 }, "offline"],
      [400, {}, "rejected"],
      [413, {}, "rejected"],
      [502, {}, "offline"],
    ];
    for (const [status, body, kind] of answers) {
      const transport = createHttpTransport({
        client: "x/1.0.0",
        fetch: (async () => new Response(JSON.stringify(body), { status })) as typeof fetch,
      });
      await expect(
        transport.put("tag", "a", { data: {}, deleted: false, baseVersion: 0 })
      ).rejects.toMatchObject({ kind });
    }
    const notJson = createHttpTransport({
      client: "x/1.0.0",
      fetch: (async () => new Response("<html>", { status: 200 })) as typeof fetch,
    });
    await expect(notJson.changes(0, 10)).rejects.toMatchObject({ kind: "offline" });
    for (const [status, body] of [
      [500, {}],
      [200, { bad: true }],
    ] as const) {
      const transport = createHttpTransport({
        client: "x/1.0.0",
        fetch: (async () => new Response(JSON.stringify(body), { status })) as typeof fetch,
      });
      await expect(transport.changes(0, 10)).rejects.toMatchObject({ kind: "offline" });
    }
  });
});
