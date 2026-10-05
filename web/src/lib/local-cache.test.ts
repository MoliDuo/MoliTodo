import { IDBDatabase, IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openLocalCache } from "./local-cache";
import { emptyState, type SyncState } from "./sync";

const ALICE = { username: "alice", name: "Alice", email: null, via: "session" as const };
const BOB = { ...ALICE, username: "bob", name: "Bob" };

const stateWith = (text: string): SyncState => ({
  ...emptyState(),
  records: {
    "task/t1": { kind: "task", id: "t1", data: { text }, deleted: false, version: 3 },
  },
  cursor: 7,
  loaded: true,
});

afterEach(() => vi.restoreAllMocks());

describe("local cache", () => {
  it("has nothing before anything is saved", async () => {
    const cache = openLocalCache(new IDBFactory());
    expect(await cache.load()).toBeNull();
    expect(await cache.loadState("alice")).toBeNull();
  });

  it("gives back the last person and their copy, in a later session too", async () => {
    const factory = new IDBFactory();
    const cache = openLocalCache(factory);
    await cache.saveMe(ALICE);
    cache.saveState("alice", stateWith("写作文"));
    await cache.flush();

    const later = openLocalCache(factory);
    expect(await later.load()).toEqual({ me: ALICE, state: stateWith("写作文") });
  });

  it("keeps each person's copy apart", async () => {
    const cache = openLocalCache(new IDBFactory());
    cache.saveState("alice", stateWith("alice 的"));
    cache.saveState("bob", stateWith("bob 的"));
    await cache.flush();
    await cache.saveMe(BOB);
    expect((await cache.load())?.state).toEqual(stateWith("bob 的"));
    expect(await cache.loadState("alice")).toEqual(stateWith("alice 的"));
  });

  it("writes a burst of changes once, shortly after the last", async () => {
    const cache = openLocalCache(new IDBFactory());
    const state = stateWith("一");
    cache.saveState("alice", state);
    state.cursor = 8;
    cache.saveState("alice", state);
    expect(await cache.loadState("alice")).toBeNull();
    await vi.waitFor(async () => expect((await cache.loadState("alice"))?.cursor).toBe(8));
  });

  it("starts empty when there is no IndexedDB, and saving does nothing", async () => {
    const cache = openLocalCache(undefined);
    await cache.saveMe(ALICE);
    cache.saveState("alice", stateWith("x"));
    await cache.flush();
    expect(await cache.load()).toBeNull();
  });

  it("starts empty when IndexedDB will not open", async () => {
    const factory = new IDBFactory();
    vi.spyOn(factory, "open").mockImplementation(() => {
      throw new Error("blocked");
    });
    const cache = openLocalCache(factory);
    expect(await cache.load()).toBeNull();
  });

  it("ignores a copy that is not in the shape it expects", async () => {
    const factory = new IDBFactory();
    const cache = openLocalCache(factory);
    await cache.saveMe(ALICE);
    cache.saveState("alice", { records: {} } as SyncState);
    await cache.flush();
    expect(await cache.load()).toEqual({ me: ALICE, state: null });
  });

  it("reads failures as nothing saved and keeps going", async () => {
    const factory = new IDBFactory();
    const cache = openLocalCache(factory);
    await cache.saveMe(ALICE);
    vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementation(() => {
      throw new Error("gone");
    });
    expect(await cache.load()).toBeNull();
    await cache.saveMe(BOB);
    vi.restoreAllMocks();
    expect((await cache.load())?.me).toEqual(ALICE);
  });

  it("starts empty when a newer copy of the database is already there", async () => {
    const factory = new IDBFactory();
    await new Promise((resolve) => (factory.open("moli-todo", 2).onsuccess = resolve));
    expect(await openLocalCache(factory).load()).toBeNull();
  });

  it("lets a save that is cut short go, and the next one still lands", async () => {
    const cache = openLocalCache(new IDBFactory());
    const put = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(function (
      this: IDBObjectStore
    ) {
      this.transaction.abort();
      return {} as IDBRequest<IDBValidKey>;
    });
    await cache.saveMe(ALICE);
    expect(await cache.load()).toBeNull();
    put.mockRestore();
    await cache.saveMe(ALICE);
    expect((await cache.load())?.me).toEqual(ALICE);
  });
});
