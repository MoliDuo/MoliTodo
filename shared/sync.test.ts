import { describe, expect, it } from "vitest";
import { createHttpTransport } from "./http-transport";
import { emptyState, SyncEngine, SyncError, type PutResult, type Transport } from "./sync";
import type { ChangesResponse, PutTaskBody, Task } from "./tasks";

/** A server in memory with the same rules as the real one: versions, a change counter, 409 on stale base. */
const plain = ({
  id,
  text,
  done,
  doneAt,
  archived,
  duration,
  position,
  deleted,
  version,
}: Task & { seq: number }): Task => ({
  id,
  text,
  done,
  doneAt,
  archived,
  duration,
  position,
  deleted,
  version,
});

class FakeServer {
  tasks = new Map<string, Task & { seq: number }>();
  seq = 0;
  down: SyncError | null = null;
  puts: string[] = [];

  transport(): Transport {
    return {
      put: async (id, body) => {
        if (this.down) throw this.down;
        this.puts.push(id);
        return this.apply(id, body);
      },
      changes: async (cursor, limit) => {
        if (this.down) throw this.down;
        const rows = [...this.tasks.values()]
          .filter((t) => t.seq > cursor)
          .sort((a, b) => a.seq - b.seq);
        const page = rows.slice(0, limit);
        const response: ChangesResponse = {
          tasks: page.map(plain),
          cursor: page.at(-1)?.seq ?? cursor,
          hasMore: rows.length > limit,
        };
        return response;
      },
    };
  }

  apply(id: string, { baseVersion, ...content }: PutTaskBody): PutResult {
    const current = this.tasks.get(id);
    if ((current?.version ?? 0) !== baseVersion) {
      return { kind: "conflict", task: current ? plain(current) : null };
    }
    this.seq += 1;
    const task = { id, ...content, version: baseVersion + 1, seq: this.seq };
    this.tasks.set(id, task);
    return { kind: "ok", task: plain(task) };
  }
}

let counter = 0;
const device = (server: FakeServer, now = () => 1_000) =>
  new SyncEngine({
    transport: server.transport(),
    now,
    newId: () => `id-${String((counter += 1)).padStart(8, "0")}`,
  });

const texts = (engine: SyncEngine) => engine.list().map((t) => t.text);

describe("SyncEngine editing", () => {
  it("adds tasks in order, trims text, and ignores empty text", () => {
    const e = device(new FakeServer());
    expect(e.add("   ")).toBeNull();
    e.add("一");
    e.add(" 二 ");
    e.add("三");
    expect(texts(e)).toEqual(["一", "二", "三"]);
    expect(e.list().every((t) => t.unsynced)).toBe(true);
  });

  it("toggles done with the time, clears it when undone, and un-archives", () => {
    let time = 5_000;
    const e = device(new FakeServer(), () => time);
    const id = e.add("x") as string;
    e.toggle(id);
    expect(e.get(id)).toMatchObject({ done: true, doneAt: 5_000 });
    e.update(id, { archived: true });
    time = 9_000;
    e.toggle(id);
    expect(e.get(id)).toMatchObject({ done: false, doneAt: null, archived: false });
  });

  it("edits text, refuses empty text, caps duration, and ignores unknown ids", () => {
    const e = device(new FakeServer());
    const id = e.add("x") as string;
    e.update(id, { text: " y " });
    e.update(id, { text: "  " });
    e.update(id, { duration: 99999.4 });
    e.update("missing", { text: "z" });
    expect(e.get(id)).toMatchObject({ text: "y", duration: 6000 });
    expect(e.get("missing")).toBeNull();
  });

  it("removes tasks from every list, and clearCompleted archives only finished ones", () => {
    const e = device(new FakeServer());
    const a = e.add("a") as string;
    const b = e.add("b") as string;
    e.add("c");
    e.toggle(a);
    e.clearCompleted();
    expect(texts(e)).toEqual(["b", "c"]);
    expect(e.all().map((t) => t.text)).toEqual(["a", "b", "c"]);
    e.remove(b);
    expect(e.all().map((t) => t.text)).toEqual(["a", "c"]);
  });

  it("removeFromList keeps a finished task in the completed view and deletes an open one", () => {
    const e = device(new FakeServer());
    const a = e.add("a") as string;
    const b = e.add("b") as string;
    e.toggle(a);
    e.removeFromList(a);
    e.removeFromList(b);
    expect(texts(e)).toEqual([]);
    expect(e.all().map((t) => t.text)).toEqual(["a"]);
    expect(e.get(a)).toMatchObject({ done: true, archived: true, deleted: false });
    expect(e.get(b)).toMatchObject({ deleted: true });
  });

  it("moves one task and leaves the others' order keys alone", () => {
    const e = device(new FakeServer());
    const [a, b, c] = ["a", "b", "c"].map((t) => e.add(t) as string);
    const before = Object.fromEntries(e.list().map((t) => [t.id, t.position]));
    e.move(c as string, a as string);
    expect(texts(e)).toEqual(["c", "a", "b"]);
    e.move(c as string, null);
    expect(texts(e)).toEqual(["a", "b", "c"]);
    e.move(a as string, c as string);
    expect(texts(e)).toEqual(["b", "a", "c"]);
    expect(e.get(b as string)?.position).toBe(before[b as string]);
    expect(e.get(c as string)?.position).not.toBeUndefined();
    e.move("nope", null);
    e.move(a as string, "nope");
    expect(texts(e)).toEqual(["b", "a", "c"]);
  });
});

describe("SyncEngine syncing", () => {
  it("sends new tasks, then another device sees them", async () => {
    const server = new FakeServer();
    const a = device(server);
    const b = device(server);
    a.add("买咖啡豆");
    a.add("写周报");
    expect((await a.sync()).status).toBe("idle");
    expect(a.list().every((t) => !t.unsynced && t.version === 1)).toBe(true);
    await b.sync();
    expect(texts(b)).toEqual(["买咖啡豆", "写周报"]);
    expect(b.getState().lastSyncAt).toBe(1_000);
  });

  it("carries edits, deletions and reorders across devices", async () => {
    const server = new FakeServer();
    const a = device(server);
    const b = device(server);
    const x = a.add("x") as string;
    const y = a.add("y") as string;
    const z = a.add("z") as string;
    await a.sync();
    await b.sync();
    b.update(x, { text: "x2" });
    b.remove(y);
    b.move(z, x);
    await b.sync();
    await a.sync();
    expect(texts(a)).toEqual(["z", "x2"]);
    expect(a.all().some((t) => t.id === y)).toBe(false);
    expect(a.getState().tasks[y]?.deleted).toBe(true);
  });

  it("keeps changes made offline and sends them when the network is back", async () => {
    const server = new FakeServer();
    const a = device(server);
    server.down = new SyncError("offline");
    a.add("离线写的");
    expect((await a.sync()).status).toBe("offline");
    expect(a.list()[0]?.unsynced).toBe(true);
    server.down = null;
    expect((await a.sync()).status).toBe("idle");
    expect(server.tasks.size).toBe(1);
    expect(a.list()[0]?.unsynced).toBe(false);
  });

  it("reports auth and upgrade without losing local data", async () => {
    const server = new FakeServer();
    const a = device(server);
    a.add("keep me");
    server.down = new SyncError("auth");
    expect((await a.sync()).status).toBe("auth");
    server.down = new SyncError("upgrade");
    expect((await a.sync()).status).toBe("upgrade");
    expect(texts(a)).toEqual(["keep me"]);
    expect(Object.keys(a.getState().pending)).toHaveLength(1);
  });

  it("lets the server win a conflict and keeps what was discarded", async () => {
    const server = new FakeServer();
    const a = device(server, () => 7_000);
    const b = device(server);
    const id = a.add("原文") as string;
    await a.sync();
    await b.sync();
    b.update(id, { text: "B 改的" });
    await b.sync();
    a.update(id, { text: "A 改的" });
    const outcome = await a.sync();
    expect(outcome.conflicts).toHaveLength(1);
    expect(outcome.conflicts[0]).toMatchObject({ id, reason: "conflict", at: 7_000 });
    expect(outcome.conflicts[0]?.discarded.text).toBe("A 改的");
    expect(texts(a)).toEqual(["B 改的"]);
    expect(a.getState().conflicts).toHaveLength(1);
    a.dismissConflict(id);
    expect(a.getState().conflicts).toHaveLength(0);
  });

  it("does not bring a deleted task back from an old edit: the deletion wins", async () => {
    const server = new FakeServer();
    const a = device(server);
    const b = device(server);
    const id = a.add("x") as string;
    await a.sync();
    await b.sync();
    b.remove(id);
    await b.sync();
    a.update(id, { text: "edited" });
    await a.sync();
    expect(a.get(id)?.deleted).toBe(true);
    expect(a.all()).toEqual([]);
    expect(a.getState().conflicts[0]?.discarded.text).toBe("edited");
  });

  it("rebases an edit made while the previous one was in flight", async () => {
    const server = new FakeServer();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const slow: Transport = {
      ...server.transport(),
      put: async (id, body) => {
        await gate;
        return server.apply(id, body);
      },
    };
    const e = new SyncEngine({ transport: slow, newId: () => "slow-0001" });
    const id = e.add("first") as string;
    const running = e.sync();
    e.update(id, { text: "second" });
    release();
    await running;
    expect(texts(e)).toEqual(["second"]);
    await e.sync();
    expect(server.tasks.get(id)?.text).toBe("second");
    expect(e.getState().conflicts).toEqual([]);
    expect(e.list()[0]?.unsynced).toBe(false);
  });

  it("joins a sync call made while another is running and runs once more", async () => {
    const server = new FakeServer();
    const e = device(server);
    e.add("a");
    const first = e.sync();
    e.add("b");
    const second = e.sync();
    expect(second).toBe(first);
    await first;
    expect(server.tasks.size).toBe(2);
  });

  it("pulls in pages", async () => {
    const server = new FakeServer();
    const a = device(server);
    for (let i = 0; i < 450; i += 1)
      server.apply(`bulk-${String(i).padStart(4, "0")}`, {
        text: `t${i}`,
        done: false,
        doneAt: null,
        archived: false,
        duration: 0,
        position: "V",
        deleted: false,
        baseVersion: 0,
      });
    await a.sync();
    expect(a.all()).toHaveLength(450);
    expect(a.getState().cursor).toBe(450);
  });

  it("drops a rejected change into conflicts instead of retrying forever", async () => {
    const server = new FakeServer();
    const bad: Transport = {
      ...server.transport(),
      put: async () => {
        throw new SyncError("rejected");
      },
    };
    const e = new SyncEngine({ transport: bad, newId: () => "bad-00001" });
    e.add("x");
    const outcome = await e.sync();
    expect(outcome.status).toBe("idle");
    expect(outcome.conflicts[0]?.reason).toBe("rejected");
    expect(Object.keys(e.getState().pending)).toEqual([]);
  });

  it("treats unexpected errors as offline", async () => {
    const e = new SyncEngine({
      transport: {
        put: async () => {
          throw new Error("boom");
        },
        changes: async () => {
          throw new Error("boom");
        },
      },
    });
    e.add("x");
    expect((await e.sync()).status).toBe("offline");
  });

  it("restores from a saved state and can be reset", async () => {
    const server = new FakeServer();
    const a = device(server);
    a.add("saved");
    const saved = JSON.parse(JSON.stringify(a.getState()));
    const b = new SyncEngine({ transport: server.transport(), state: saved });
    expect(texts(b)).toEqual(["saved"]);
    await b.sync();
    b.reset();
    expect(b.getState()).toEqual(emptyState());
  });

  it("notifies on every change", async () => {
    const seen: string[] = [];
    const e = new SyncEngine({
      transport: new FakeServer().transport(),
      onChange: (_state, status) => seen.push(status),
    });
    e.add("x");
    await e.sync();
    expect(seen).toContain("syncing");
    expect(seen.at(-1)).toBe("idle");
  });
});

describe("addMissing (add-only)", () => {
  const content = (text: string, position: string) => ({
    text,
    done: false,
    doneAt: null,
    archived: false,
    duration: 0,
    position,
    deleted: false,
  });

  it("adds new ids, skips known ones, and drops quietly when the server already has the id", async () => {
    const server = new FakeServer();
    const a = device(server);
    const b = device(server);
    const items = [
      { id: "legacy-aaaaaaaa", content: content("一", "V") },
      { id: "legacy-bbbbbbbb", content: content("二", "W") },
    ];
    expect(a.addMissing(items)).toBe(2);
    expect(a.addMissing(items)).toBe(0);
    await a.sync();
    // b imports the same file before it has pulled anything.
    expect(b.addMissing(items)).toBe(2);
    const outcome = await b.sync();
    expect(outcome.conflicts).toEqual([]);
    expect(texts(b)).toEqual(["一", "二"]);
    expect(server.tasks.size).toBe(2);
  });

  it("never revives a task that was deleted after import", async () => {
    const server = new FakeServer();
    const a = device(server);
    const items = [{ id: "legacy-cccccccc", content: content("三", "V") }];
    a.addMissing(items);
    await a.sync();
    a.remove("legacy-cccccccc");
    await a.sync();
    expect(a.addMissing(items)).toBe(0);
    expect(a.list()).toEqual([]);
  });
});

describe("createHttpTransport", () => {
  const task: Task = {
    id: "t-0000001",
    text: "x",
    done: false,
    doneAt: null,
    archived: false,
    duration: 0,
    position: "V",
    deleted: false,
    version: 1,
  };
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const body: PutTaskBody = { ...task, baseVersion: 0 };

  function transportWith(
    handler: (url: string, init: RequestInit) => Response | Promise<Response>
  ) {
    const calls: { url: string; init: RequestInit }[] = [];
    const transport = createHttpTransport({
      baseUrl: "https://todo.example.com",
      client: "todo-desktop/2.0.0",
      headers: () => ({ authorization: "Bearer abc" }),
      fetch: async (input, init) => {
        calls.push({ url: String(input), init: init ?? {} });
        return handler(String(input), init ?? {});
      },
    });
    return { transport, calls };
  }

  it("sends the client version and headers, and reads ok and conflict answers", async () => {
    const ok = transportWith(() => json(200, { task }));
    expect(await ok.transport.put(task.id, body)).toEqual({ kind: "ok", task });
    const call = ok.calls[0];
    expect(call?.url).toBe("https://todo.example.com/api/v1/tasks/t-0000001");
    expect(call?.init.method).toBe("PUT");
    expect(call?.init.headers).toMatchObject({
      "x-moli-client": "todo-desktop/2.0.0",
      authorization: "Bearer abc",
      "content-type": "application/json",
    });

    const conflict = transportWith(() =>
      json(409, { error: { code: "conflict", message: "m" }, task })
    );
    expect(await conflict.transport.put(task.id, body)).toEqual({ kind: "conflict", task });
    const gone = transportWith(() =>
      json(409, { error: { code: "conflict", message: "m" }, task: null })
    );
    expect(await gone.transport.put(task.id, body)).toEqual({ kind: "conflict", task: null });
  });

  it("reads changes", async () => {
    const t = transportWith(() => json(200, { tasks: [task], cursor: 4, hasMore: false }));
    expect(await t.transport.changes(3, 200)).toEqual({ tasks: [task], cursor: 4, hasMore: false });
    expect(t.calls[0]?.url).toBe(
      "https://todo.example.com/api/v1/tasks/changes?cursor=3&limit=200"
    );
  });

  it.each([
    [401, "auth"],
    [403, "auth"],
    [426, "upgrade"],
    [500, "offline"],
    [502, "offline"],
    [429, "offline"],
    [400, "rejected"],
  ])("maps status %i to %s", async (status, kind) => {
    const t = transportWith(() => json(status, { error: { code: "x", message: "m" } }));
    await expect(t.transport.put(task.id, body)).rejects.toMatchObject({ kind });
  });

  it("treats network failures and garbled answers as offline", async () => {
    const down = createHttpTransport({
      client: "todo-web/2.0.0",
      fetch: async () => {
        throw new TypeError("failed to fetch");
      },
    });
    await expect(down.changes(0, 10)).rejects.toMatchObject({ kind: "offline" });
    const garbled = transportWith(() => new Response("<html>", { status: 200 }));
    await expect(garbled.transport.changes(0, 10)).rejects.toMatchObject({ kind: "offline" });
    const wrongShape = transportWith(() => json(200, { nope: true }));
    await expect(wrongShape.transport.changes(0, 10)).rejects.toMatchObject({ kind: "offline" });
    await expect(wrongShape.transport.put(task.id, body)).rejects.toMatchObject({
      kind: "offline",
    });
    const wrongConflict = transportWith(() => json(409, { nope: true }));
    await expect(wrongConflict.transport.put(task.id, body)).rejects.toMatchObject({
      kind: "offline",
    });
    const changes500 = transportWith(() => json(500, {}));
    await expect(changes500.transport.changes(0, 10)).rejects.toMatchObject({ kind: "offline" });
  });
});
