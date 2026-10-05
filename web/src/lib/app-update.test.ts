import { describe, expect, it, vi } from "vitest";
import {
  announceUpdate,
  applyUpdate,
  dropAppShell,
  hasUpdate,
  subscribeUpdate,
} from "./app-update";

describe("app update", () => {
  it("tells listeners when a new version is ready", () => {
    const listener = vi.fn();
    const stop = subscribeUpdate(listener);
    const apply = vi.fn();
    announceUpdate(apply);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(hasUpdate()).toBe(true);

    applyUpdate();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(hasUpdate()).toBe(false);
    applyUpdate();
    expect(apply).toHaveBeenCalledTimes(1);

    stop();
    announceUpdate(apply);
    expect(listener).toHaveBeenCalledTimes(3);
    applyUpdate();
  });

  it("forgets every kept copy of the app", async () => {
    const unregister = vi.fn(async () => true);
    const container = {
      getRegistrations: async () => [{ unregister }, { unregister }],
    } as unknown as ServiceWorkerContainer;
    await dropAppShell(container);
    expect(unregister).toHaveBeenCalledTimes(2);
  });

  it("does nothing without a service worker, or when it cannot be reached", async () => {
    await expect(dropAppShell(undefined)).resolves.toBeUndefined();
    const broken = {
      getRegistrations: async () => {
        throw new Error("denied");
      },
    } as unknown as ServiceWorkerContainer;
    await expect(dropAppShell(broken)).resolves.toBeUndefined();
  });
});
