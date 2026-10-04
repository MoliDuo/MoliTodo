import { describe, expect, it } from "vitest";
import {
  CHECK_INTERVAL_MS,
  createUpdateController,
  FIRST_CHECK_DELAY_MS,
  UpdaterUnavailableError,
  type UpdateOffer,
  type Updater,
} from "./updates";

const offer: UpdateOffer = { version: "2.1.0", notes: "新功能" };

function setup(overrides: Partial<Updater> = {}) {
  const calls = { check: 0, install: 0 };
  const timers: { run: () => void; ms: number; cleared: boolean }[] = [];
  const updater: Updater = {
    check: async () => {
      calls.check += 1;
      return offer;
    },
    install: async () => {
      calls.install += 1;
    },
    installBlocked: async () => false,
    ...overrides,
  };
  const controller = createUpdateController({
    updater,
    setTimer: (run, ms) => {
      const timer = { run, ms, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (handle) => {
      (handle as { cleared: boolean }).cleared = true;
    },
  });
  return { controller, calls, timers };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("schedule", () => {
  it("checks after about 10 seconds, then every hour, until stopped", async () => {
    const { controller, calls, timers } = setup();
    controller.start();
    controller.start();
    expect(timers).toHaveLength(1);
    expect(timers[0]?.ms).toBe(FIRST_CHECK_DELAY_MS);
    timers[0]?.run();
    await settle();
    expect(calls.check).toBe(1);
    expect(timers[1]?.ms).toBe(CHECK_INTERVAL_MS);
    controller.stop();
    expect(timers[1]?.cleared).toBe(true);
    timers[1]?.run();
    await settle();
    expect(timers).toHaveLength(2);
  });

  it("stops asking when this build cannot update", async () => {
    const { controller, timers } = setup({
      check: async () => {
        throw new UpdaterUnavailableError();
      },
    });
    controller.start();
    timers[0]?.run();
    await settle();
    expect(timers).toHaveLength(1);
    expect(controller.getState()).toEqual({ phase: "idle" });
  });
});

describe("checking", () => {
  it("says nothing when this is the latest, unless the person asked", async () => {
    const { controller } = setup({ check: async () => null });
    await controller.checkNow();
    expect(controller.getState()).toEqual({ phase: "idle" });
    await controller.checkNow({ manual: true });
    expect(controller.getState()).toEqual({ phase: "message", text: "已是最新版本。" });
  });

  it("offers a newer version and notifies listeners", async () => {
    const { controller } = setup();
    let notified = 0;
    const stop = controller.subscribe(() => (notified += 1));
    await controller.checkNow();
    expect(controller.getState()).toEqual({ phase: "available", offer });
    expect(notified).toBe(1);
    await controller.checkNow();
    expect(notified).toBe(1);
    stop();
    controller.dismiss();
    expect(notified).toBe(1);
  });

  it("does not ask again about a version the person put off, except when asked or when sync needs it", async () => {
    const { controller } = setup();
    await controller.checkNow();
    controller.dismiss();
    expect(controller.getState()).toEqual({ phase: "idle" });
    await controller.checkNow();
    expect(controller.getState()).toEqual({ phase: "idle" });
    await controller.checkNow({ ignoreDismissed: true });
    expect(controller.getState().phase).toBe("available");
    controller.dismiss();
    await controller.checkNow({ manual: true });
    expect(controller.getState().phase).toBe("available");
  });

  it("stays quiet when the feed cannot be reached, but a manual check says so", async () => {
    const { controller } = setup({
      check: async () => {
        throw new Error("offline");
      },
    });
    await controller.checkNow();
    expect(controller.getState()).toEqual({ phase: "idle" });
    await controller.checkNow({ manual: true });
    expect(controller.getState()).toEqual({
      phase: "message",
      text: "现在连不上更新源，请稍后再试。",
    });
  });

  it("tells a manual check that this build has no updater", async () => {
    const { controller } = setup({
      check: async () => {
        throw new UpdaterUnavailableError();
      },
    });
    await controller.checkNow({ manual: true });
    expect(controller.getState()).toEqual({
      phase: "message",
      text: "这个版本没有内置更新功能。",
    });
  });

  it("runs one check at a time", async () => {
    let release: (value: UpdateOffer | null) => void = () => undefined;
    const { controller, calls } = setup({
      check: () => new Promise((resolve) => (release = resolve)),
    });
    const first = controller.checkNow();
    await controller.checkNow();
    release(null);
    await first;
    expect(calls.check).toBe(0);
  });
});

describe("installing", () => {
  it("does nothing without an offer", async () => {
    const { controller, calls } = setup();
    await controller.install();
    expect(calls.install).toBe(0);
  });

  it("installs the offered version", async () => {
    let seen: unknown;
    const { controller, calls } = setup();
    controller.subscribe(() => (seen = controller.getState()));
    await controller.checkNow();
    const pending = controller.install();
    await pending;
    expect(calls.install).toBe(1);
    expect(seen).toEqual({ phase: "installing", offer });
    await controller.checkNow();
    expect(calls.check).toBe(1);
  });

  it("asks to move the app first when it runs from a disk image", async () => {
    const { controller, calls } = setup({ installBlocked: async () => true });
    await controller.checkNow();
    await controller.install();
    expect(calls.install).toBe(0);
    expect(controller.getState()).toEqual({
      phase: "message",
      text: "请先把应用移到「应用程序」文件夹，再更新。",
    });
  });

  it("keeps the running version when the install fails", async () => {
    const { controller } = setup({
      install: async () => {
        throw new Error("signature mismatch");
      },
    });
    await controller.checkNow();
    await controller.install();
    expect(controller.getState()).toEqual({
      phase: "message",
      text: "更新没有完成，当前版本不受影响，稍后会再试。",
    });
    await controller.checkNow();
    expect(controller.getState().phase).toBe("available");
  });
});
