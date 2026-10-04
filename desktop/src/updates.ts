// Update checks. This app departs from standard 007, 7.4 ("never forced"): while the interface is still
// changing fast, an old app can break against the current server, so a newer version has to be installed
// before the app can be used again. Quiet when there is nothing or the feed cannot be reached (an offline
// app keeps working), and a failed update leaves the running version alone. The actual download and
// install is behind the `Updater` interface, so this logic is tested without the update plugin.

export interface UpdateOffer {
  version: string;
  notes: string;
}

/** This build has no update key, so it cannot check (a development build, or a release without the key). */
export class UpdaterUnavailableError extends Error {}

export interface Updater {
  /** The newer version, or null when this one is the latest. Throws when the feed cannot be read. */
  check(): Promise<UpdateOffer | null>;
  /** Downloads and installs what the last `check` found, then restarts the app. */
  install(): Promise<void>;
  /** True when the app runs from somewhere it cannot replace itself (a mounted disk image). */
  installBlocked(): Promise<boolean>;
}

export type UpdateState =
  | { phase: "idle" }
  /** A newer version is out: the app is locked until it is installed. `error` says why the last try did not finish. */
  | { phase: "required"; offer: UpdateOffer; error?: string }
  | { phase: "installing"; offer: UpdateOffer }
  /** The server turned this version away (426) and the feed had nothing to install; locked as well. */
  | { phase: "outdated"; error?: string }
  /** The answer to a check the person asked for; shown until dismissed. */
  | { phase: "message"; text: string };

/** The states in which the app cannot be used until it is updated. */
export function isLocked(
  state: UpdateState
): state is Extract<UpdateState, { phase: "required" | "installing" | "outdated" }> {
  return state.phase === "required" || state.phase === "installing" || state.phase === "outdated";
}

export const FIRST_CHECK_DELAY_MS = 0;
export const CHECK_INTERVAL_MS = 60 * 60 * 1000;

export interface CheckOptions {
  /** The person asked: report "up to date" and failures. Background checks stay silent. */
  manual?: boolean;
}

export interface UpdateController {
  getState(): UpdateState;
  subscribe(listener: () => void): () => void;
  /** First check right away, then every hour. */
  start(): void;
  stop(): void;
  checkNow(options?: CheckOptions): Promise<void>;
  /** The server says this version is too old: look for the update now, and lock the app either way. */
  serverRejected(): Promise<void>;
  /** Closes a message; a required update cannot be put off. */
  dismiss(): void;
  install(): Promise<void>;
}

export function createUpdateController(options: {
  updater: Updater;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}): UpdateController {
  const { updater } = options;
  const setTimer = options.setTimer ?? ((run, ms) => setTimeout(run, ms));
  const clearTimer =
    options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const listeners = new Set<() => void>();
  let state: UpdateState = { phase: "idle" };
  let timer: unknown = null;
  let running = false;
  let checking = false;
  /** The server answered 426 at least once in this run. */
  let rejected = false;

  const set = (next: UpdateState) => {
    state = next;
    listeners.forEach((listener) => listener());
  };

  const schedule = (ms: number) => {
    timer = setTimer(() => {
      void controller.checkNow().finally(() => {
        if (running) schedule(CHECK_INTERVAL_MS);
      });
    }, ms);
  };

  /** Nothing to install: locked when the server refused this version, otherwise only a manual check hears about it. */
  const nothingToInstall = (manual: boolean, text: string) => {
    if (rejected) set(manual ? { phase: "outdated", error: text } : { phase: "outdated" });
    else if (manual) set({ phase: "message", text });
  };

  const controller: UpdateController = {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start() {
      if (running) return;
      running = true;
      schedule(FIRST_CHECK_DELAY_MS);
    },
    stop() {
      running = false;
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
    async checkNow({ manual = false } = {}) {
      // One check or install at a time; a second check meanwhile says nothing new.
      if (checking || state.phase === "installing") return;
      checking = true;
      try {
        const offer = await updater.check();
        if (offer === null) {
          // The release was withdrawn after it was offered: there is nothing to install any more.
          if (state.phase === "required") set({ phase: "idle" });
          nothingToInstall(
            manual,
            rejected ? "还没有可安装的新版本，请稍后再试。" : "已是最新版本。"
          );
          return;
        }
        // A prompt that is already up for this version stays as it is.
        if (state.phase === "required" && state.offer.version === offer.version) return;
        set({ phase: "required", offer });
      } catch (error) {
        if (error instanceof UpdaterUnavailableError) {
          // Nothing to schedule: this build can never update.
          controller.stop();
          nothingToInstall(manual, "这个版本没有内置更新功能。");
          return;
        }
        // Offline is not an error for an app that works offline (7.4.6a): only a manual check says so.
        nothingToInstall(manual, "现在连不上更新源，请稍后再试。");
      } finally {
        checking = false;
      }
    },
    async serverRejected() {
      if (isLocked(state)) return;
      rejected = true;
      // A check already under way locks the app when it finds nothing, because `rejected` is read when it ends.
      await controller.checkNow();
    },
    dismiss() {
      if (state.phase === "message") set({ phase: "idle" });
    },
    async install() {
      if (state.phase !== "required") return;
      const offer = state.offer;
      if (await updater.installBlocked()) {
        set({ phase: "required", offer, error: "请先把应用移到「应用程序」文件夹，再更新。" });
        return;
      }
      set({ phase: "installing", offer });
      try {
        await updater.install();
        // Normally the app restarts and never gets here.
      } catch {
        // The running version is untouched (7.4.6), but it stays locked until the update goes in.
        set({ phase: "required", offer, error: "更新没有完成，请重试。" });
      }
    },
  };
  return controller;
}
