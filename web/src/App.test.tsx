import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { signInUrl } from "./api";
import { createFakeApi } from "./test-support/fake-api";
import { renderApp, seedTask, TODAY } from "./test-support/render-app";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("App sign-in", () => {
  it("goes back through sign-in when the session is gone", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, pathname: "/tasks", search: "?a=1", assign });
    const api = createFakeApi();
    api.fail = 401;
    render(<App fetchFn={api.fetch} />);
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/auth/login?next=%2Ftasks%3Fa%3D1"));
  });

  it("says so when the server fails", async () => {
    const api = createFakeApi();
    api.fail = 500;
    render(<App fetchFn={api.fetch} />);
    expect(await screen.findByRole("alert")).toBeTruthy();
  });

  it("shows today once signed in", async () => {
    const api = createFakeApi();
    window.history.replaceState(null, "", "#/");
    render(<App fetchFn={api.fetch} />);
    expect(await screen.findByRole("list", { name: "任务" })).toBeTruthy();
  });
});

describe("signInUrl", () => {
  it("keeps the path and query as the place to return to", () => {
    expect(signInUrl({ pathname: "/", search: "" })).toBe("/auth/login?next=%2F");
  });
});

describe("Shell", () => {
  it("shows the day's tasks from the server", async () => {
    const api = createFakeApi();
    seedTask(api, TODAY, "流程图类 #小作文", { done: true, duration: 45 });
    await renderApp({ api });
    const list = screen.getByRole("list", { name: "任务" });
    await waitFor(() => expect(list.textContent).toContain("流程图类 #小作文"));
    expect(list.textContent).toContain("45min");
  });
});
