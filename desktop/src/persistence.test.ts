import { describe, expect, it, vi } from "vitest";
import { createSaver, defaultSettings, loadSettings, loadState } from "./persistence";
import { createMemoryPlatform } from "./test-support";

describe("loadSettings", () => {
  it("gives the defaults when there is no file", async () => {
    const platform = createMemoryPlatform();
    expect(await loadSettings(platform)).toEqual({
      refreshToken: null,
      account: null,
      bounds: null,
      collapsed: false,
      permanentTop: true,
    });
  });

  it("reads a saved file, fills in fields an older version did not have, and ignores unknown ones", async () => {
    const platform = createMemoryPlatform(undefined, {
      "settings.json": JSON.stringify({ refreshToken: "r", collapsed: true, somethingNew: 1 }),
    });
    expect(await loadSettings(platform)).toMatchObject({
      refreshToken: "r",
      collapsed: true,
      permanentTop: true,
    });
  });

  it("moves an unreadable file aside and starts from the defaults", async () => {
    for (const text of ["{broken", JSON.stringify({ collapsed: "yes" })]) {
      const platform = createMemoryPlatform(undefined, { "settings.json": text });
      expect(await loadSettings(platform)).toEqual(defaultSettings());
      expect(platform.quarantined).toEqual(["settings.json"]);
    }
  });

  it("starts from the defaults when the file cannot be read at all", async () => {
    const platform = createMemoryPlatform();
    platform.readFile = async () => {
      throw new Error("denied");
    };
    expect(await loadSettings(platform)).toEqual(defaultSettings());
    expect(platform.quarantined).toEqual([]);
  });
});

describe("loadState", () => {
  it("starts empty", async () => {
    const state = await loadState(createMemoryPlatform());
    expect(state.owner).toBeNull();
    expect(state.sync).toMatchObject({ tasks: {}, pending: {}, cursor: 0, conflicts: [] });
  });

  it("reads a saved copy back", async () => {
    const task = {
      id: "task-0001",
      text: "x",
      done: false,
      doneAt: null,
      archived: false,
      duration: 0,
      position: "V",
      deleted: false,
      version: 2,
    };
    const platform = createMemoryPlatform(undefined, {
      "state.json": JSON.stringify({
        owner: "alice",
        sync: { tasks: { [task.id]: task }, pending: {}, cursor: 7, conflicts: [], lastSyncAt: 5 },
      }),
    });
    const state = await loadState(platform);
    expect(state.owner).toBe("alice");
    expect(state.sync.cursor).toBe(7);
    expect(state.sync.tasks["task-0001"]?.version).toBe(2);
  });

  it("quarantines a file with the wrong shape", async () => {
    const platform = createMemoryPlatform(undefined, {
      "state.json": JSON.stringify({ sync: { tasks: 3 } }),
    });
    expect((await loadState(platform)).sync.cursor).toBe(0);
    expect(platform.quarantined).toEqual(["state.json"]);
  });
});

describe("createSaver", () => {
  it("writes the latest content once after the delay", async () => {
    vi.useFakeTimers();
    const written: string[] = [];
    const saver = createSaver(
      async (text) => void written.push(text),
      100,
      () => undefined
    );
    saver.schedule(() => "a");
    saver.schedule(() => "b");
    expect(written).toEqual([]);
    await vi.advanceTimersByTimeAsync(100);
    expect(written).toEqual(["b"]);
    vi.useRealTimers();
  });

  it("flush writes now and waits for it", async () => {
    const written: string[] = [];
    const saver = createSaver(
      async (text) => void written.push(text),
      10_000,
      () => undefined
    );
    saver.schedule(() => "now");
    await saver.flush();
    expect(written).toEqual(["now"]);
    await saver.flush();
    expect(written).toEqual(["now"]);
  });

  it("never runs two writes at once, and folds changes made meanwhile into one more write", async () => {
    const order: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let first = true;
    const saver = createSaver(
      async (text) => {
        order.push(`start ${text}`);
        if (first) {
          first = false;
          await gate;
        }
        order.push(`end ${text}`);
      },
      10_000,
      () => undefined
    );
    saver.schedule(() => "1");
    const flushing = saver.flush();
    saver.schedule(() => "2");
    const flushingAgain = saver.flush();
    release();
    await Promise.all([flushing, flushingAgain]);
    expect(order).toEqual(["start 1", "end 1", "start 2", "end 2"]);
  });

  it("reports a failed write and keeps going", async () => {
    const errors: unknown[] = [];
    let fail = true;
    const written: string[] = [];
    const saver = createSaver(
      async (text) => {
        if (fail) throw new Error("disk full");
        written.push(text);
      },
      10,
      (error) => errors.push(error)
    );
    saver.schedule(() => "a");
    await saver.flush();
    fail = false;
    saver.schedule(() => "b");
    await saver.flush();
    expect(errors).toHaveLength(1);
    expect(written).toEqual(["b"]);
  });
});
