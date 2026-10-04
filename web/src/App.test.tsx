import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { signInUrl } from "./api";

const respond = (status: number, body: unknown) =>
  vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      })
  );

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("App", () => {
  it("shows who is signed in", async () => {
    const fetchFn = respond(200, { username: "alice", name: "Alice", email: null, via: "session" });
    render(<App fetchFn={fetchFn as unknown as typeof fetch} />);
    expect(await screen.findByText("Alice")).toBeTruthy();
  });

  it("goes back through sign-in when the session is gone", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, pathname: "/tasks", search: "?a=1", assign });
    const fetchFn = respond(401, { error: { code: "unauthorized", message: "Sign in required" } });
    render(<App fetchFn={fetchFn as unknown as typeof fetch} />);
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/auth/login?next=%2Ftasks%3Fa%3D1"));
    vi.unstubAllGlobals();
  });

  it("says so when the server fails", async () => {
    const fetchFn = respond(500, { error: { code: "internal", message: "x" } });
    render(<App fetchFn={fetchFn as unknown as typeof fetch} />);
    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});

describe("signInUrl", () => {
  it("keeps the path and query as the place to return to", () => {
    expect(signInUrl({ pathname: "/", search: "" })).toBe("/auth/login?next=%2F");
  });
});
