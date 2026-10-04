import { render, screen, waitFor } from "@testing-library/react";
import { expect } from "vitest";
import type { SessionData, TaskData } from "@shared/records";
import { Shell } from "../Shell";
import { createTodoStore } from "../store";
import { createFakeApi, ME } from "./fake-api";

/** 2026-10-04 21:30 in Singapore, a Sunday: "today" in page tests. */
export const NOW = Date.parse("2026-10-04T13:30:00Z");
export const TODAY = "2026-10-04";

export type FakeApi = ReturnType<typeof createFakeApi>;

let next = 0;
const id = (prefix: string) => `${prefix}-${String((next += 1)).padStart(4, "0")}`;

/** A task on the server, as another device would have written it. Positions keep the order they are made in. */
export function seedTask(
  api: FakeApi,
  day: string,
  text: string,
  over: Partial<TaskData> = {}
): string {
  const taskId = id("task");
  const data: TaskData = {
    day,
    text,
    indent: 0,
    done: false,
    doneAt: null,
    duration: null,
    highlight: null,
    position: `V${String(next).padStart(4, "0")}`,
    ...over,
  };
  api.remote("task", taskId, data);
  return taskId;
}

export function seedSession(api: FakeApi, name: string, day: string, seconds: number): string {
  const sessionId = id("session");
  const endedAt = Date.parse(`${day}T12:00:00+08:00`);
  const data: SessionData = { name, day, seconds, startedAt: endedAt - seconds * 1000, endedAt };
  api.remote("session", sessionId, data);
  return sessionId;
}

/**
 * The signed-in app at `hash` with a fixed clock, after the first sync has landed. `clock` can be a function
 * whose value the test moves forward.
 */
export async function renderApp({
  api = createFakeApi(),
  hash = "#/",
  clock = () => NOW,
}: { api?: FakeApi; hash?: string; clock?: () => number } = {}) {
  window.history.replaceState(null, "", hash);
  const store = createTodoStore(api.fetch);
  const view = render(<Shell store={store} me={ME} clock={clock} />);
  await waitFor(() =>
    expect(api.requests.some((r) => r.url.startsWith("/api/v2/changes"))).toBe(true)
  );
  await waitFor(() => expect(store.engine.getStatus()).toBe("idle"));
  return { api, store, engine: store.engine, view, screen };
}

/** Waits until every local change has reached the fake server. */
export async function synced(store: { engine: { getState(): { pending: object } } }) {
  await waitFor(() => expect(Object.keys(store.engine.getState().pending)).toHaveLength(0), {
    timeout: 3000,
  });
}
