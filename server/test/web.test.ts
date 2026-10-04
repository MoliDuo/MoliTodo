import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTestApp } from "../test-support/app.js";

type Ctx = Awaited<ReturnType<typeof createTestApp>>;
let ctx: Ctx;
afterEach(async () => ctx?.app.close());

function webDist() {
  const dir = mkdtempSync(join(tmpdir(), "todo-web-"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>Moli Todo</title>");
  writeFileSync(join(dir, "assets", "app.js"), "console.log(1)");
  return dir;
}

describe("pages", () => {
  it("sends a signed-out browser to the sign-in start, keeping where it was going", async () => {
    ctx = await createTestApp({ WEB_DIST: webDist() });
    for (const [url, next] of [
      ["/", "%2F"],
      ["/done?day=1", "%2Fdone%3Fday%3D1"],
    ] as const) {
      const res = await ctx.app.inject({ method: "GET", url });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe(`/auth/login?next=${next}`);
    }
  });

  it("follows redirects only: signed out, the chain ends at the identity service", async () => {
    ctx = await createTestApp({ WEB_DIST: webDist() });
    const first = await ctx.app.inject({ method: "GET", url: "/" });
    const second = await ctx.app.inject({ method: "GET", url: String(first.headers.location) });
    expect(new URL(String(second.headers.location)).origin).toBe("https://auth.example.com");
    expect(second.headers["content-type"] ?? "").not.toContain("text/html");
  });

  it("serves the page to a signed-in browser, never cached", async () => {
    ctx = await createTestApp({ WEB_DIST: webDist() });
    const { cookie } = await ctx.signIn();
    for (const url of ["/", "/done"]) {
      const res = await ctx.app.inject({ method: "GET", url, cookies: cookie });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain("Moli Todo");
      expect(res.headers["cache-control"]).toBe("no-store");
    }
  });

  it("serves built assets without signing in", async () => {
    ctx = await createTestApp({ WEB_DIST: webDist() });
    const res = await ctx.app.inject({ method: "GET", url: "/assets/app.js" });
    expect(res.statusCode).toBe(200);
  });

  it("answers 404 JSON for unknown files and unknown API paths", async () => {
    ctx = await createTestApp({ WEB_DIST: webDist() });
    const { cookie } = await ctx.signIn();
    for (const url of ["/assets/missing.js", "/api/v1/nothing"]) {
      const res = await ctx.app.inject({ method: "GET", url, cookies: cookie });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: { code: "not_found", message: "Not found" } });
    }
  });

  it("does not serve index.html as a file to a signed-out browser", async () => {
    ctx = await createTestApp({ WEB_DIST: webDist() });
    const res = await ctx.app.inject({ method: "GET", url: "/index.html" });
    expect(res.statusCode).toBe(404);
  });
});

describe("without a built web UI", () => {
  it("still serves the API", async () => {
    ctx = await createTestApp();
    expect((await ctx.app.inject({ method: "GET", url: "/healthz" })).statusCode).toBe(200);
  });
});
