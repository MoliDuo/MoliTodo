import { describe, expect, it } from "vitest";
import { createTestApp, APP_URL } from "../test-support/app.js";
import type { PutTaskBody } from "@shared/tasks";

const body = (over: Partial<PutTaskBody> = {}): PutTaskBody => ({
  text: "买咖啡豆",
  done: false,
  doneAt: null,
  archived: false,
  duration: 0,
  position: "V",
  deleted: false,
  baseVersion: 0,
  ...over,
});

const ID = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";

async function setup(config = {}) {
  const t = await createTestApp(config);
  const { cookie } = await t.signIn("alice");
  const put = (id: string, payload: unknown, who: Record<string, string> = cookie) =>
    t.app.inject({
      method: "PUT",
      url: `/api/v1/tasks/${id}`,
      headers: { origin: APP_URL },
      cookies: who,
      payload: payload as object,
    });
  const changes = (query = "", who: Record<string, string> = cookie) =>
    t.app.inject({ method: "GET", url: `/api/v1/tasks/changes${query}`, cookies: who });
  return { ...t, cookie, put, changes };
}

describe("tasks API", () => {
  it("requires sign-in", async () => {
    const t = await setup();
    const get = await t.app.inject({ method: "GET", url: "/api/v1/tasks/changes" });
    expect(get.statusCode).toBe(401);
    const put = await t.app.inject({
      method: "PUT",
      url: `/api/v1/tasks/${ID}`,
      headers: { origin: APP_URL },
      payload: body(),
    });
    expect(put.statusCode).toBe(401);
  });

  it("creates a task at version 1 and returns it in changes", async () => {
    const t = await setup();
    const res = await t.put(ID, body());
    expect(res.statusCode).toBe(200);
    expect(res.json().task).toMatchObject({ id: ID, text: "买咖啡豆", version: 1 });
    const list = (await t.changes()).json();
    expect(list.hasMore).toBe(false);
    expect(list.cursor).toBe(1);
    expect(list.tasks).toHaveLength(1);
  });

  it("raises the version on each change and moves the cursor", async () => {
    const t = await setup();
    await t.put(ID, body());
    await t.put(ID2, body({ text: "写周报", position: "W" }));
    const second = await t.put(ID, body({ text: "买咖啡", baseVersion: 1 }));
    expect(second.json().task.version).toBe(2);
    const after = (await t.changes("?cursor=2")).json();
    expect(after.tasks.map((x: { id: string }) => x.id)).toEqual([ID]);
    expect(after.cursor).toBe(3);
    expect((await t.changes("?cursor=3")).json()).toEqual({ tasks: [], cursor: 3, hasMore: false });
  });

  it("pages changes with limit and hasMore", async () => {
    const t = await setup();
    for (let i = 0; i < 5; i += 1) {
      await t.put(`aaaaaaaa-0000-4000-8000-00000000000${i}`, body({ text: `t${i}` }));
    }
    const first = (await t.changes("?limit=2")).json();
    expect(first.tasks).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    const second = (await t.changes(`?limit=2&cursor=${first.cursor}`)).json();
    const third = (await t.changes(`?limit=2&cursor=${second.cursor}`)).json();
    expect([second.hasMore, third.hasMore, third.tasks.length]).toEqual([true, false, 1]);
  });

  it("answers 409 with the server's task when the base version is old", async () => {
    const t = await setup();
    await t.put(ID, body());
    await t.put(ID, body({ text: "改过了", baseVersion: 1 }));
    const stale = await t.put(ID, body({ text: "另一台的修改", baseVersion: 1 }));
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("conflict");
    expect(stale.json().task).toMatchObject({ text: "改过了", version: 2 });
    expect((await t.changes()).json().tasks[0].text).toBe("改过了");
  });

  it("answers 409 when creating an id that exists, including a deleted one", async () => {
    const t = await setup();
    await t.put(ID, body());
    await t.put(ID, body({ deleted: true, baseVersion: 1 }));
    const again = await t.put(ID, body());
    expect(again.statusCode).toBe(409);
    expect(again.json().task).toMatchObject({ deleted: true, version: 2 });
  });

  it("answers 409 with null for a base version of a task the server never had", async () => {
    const t = await setup();
    const res = await t.put(ID, body({ baseVersion: 3 }));
    expect(res.statusCode).toBe(409);
    expect(res.json().task).toBeNull();
  });

  it("treats a re-sent change as done, not as a conflict", async () => {
    const t = await setup();
    await t.put(ID, body());
    const again = await t.put(ID, body());
    expect(again.statusCode).toBe(200);
    expect(again.json().task.version).toBe(1);
    expect((await t.changes()).json().cursor).toBe(1);
  });

  it("keeps deletion markers in changes and lets a deleted task come back", async () => {
    const t = await setup();
    await t.put(ID, body());
    await t.put(ID, body({ deleted: true, baseVersion: 1 }));
    expect((await t.changes("?cursor=1")).json().tasks[0]).toMatchObject({ deleted: true });
    const back = await t.put(ID, body({ baseVersion: 2 }));
    expect(back.json().task).toMatchObject({ deleted: false, version: 3 });
  });

  it("keeps each person's tasks apart", async () => {
    const t = await setup();
    await t.put(ID, body());
    const bob = (await t.signIn("bob")).cookie;
    expect((await t.changes("", bob)).json().tasks).toEqual([]);
    const created = await t.put(ID, body({ text: "bob 的" }), bob);
    expect(created.statusCode).toBe(200);
    expect((await t.changes()).json().tasks[0].text).toBe("买咖啡豆");
  });

  it("rejects bad input", async () => {
    const t = await setup();
    for (const payload of [
      body({ text: "   " }),
      body({ text: "x".repeat(2001) }),
      body({ duration: -1 }),
      body({ duration: 6001 }),
      body({ position: "a0" }),
      body({ position: "" }),
      { ...body(), done: "yes" },
      { text: "missing fields" },
    ]) {
      expect((await t.put(ID, payload)).statusCode).toBe(400);
    }
    expect((await t.put("bad id!", body())).statusCode).toBe(400);
    expect((await t.changes("?limit=0")).statusCode).toBe(400);
    expect((await t.changes("?limit=501")).statusCode).toBe(400);
    expect((await t.changes("?cursor=-1")).statusCode).toBe(400);
  });

  it("refuses writes from another origin", async () => {
    const t = await setup();
    const res = await t.app.inject({
      method: "PUT",
      url: `/api/v1/tasks/${ID}`,
      headers: { origin: "https://evil.example" },
      cookies: t.cookie,
      payload: body(),
    });
    expect(res.statusCode).toBe(403);
  });

  it("works with a desktop bearer token", async () => {
    const t = await setup();
    const token = await t.issuer.nativeToken("carol");
    const res = await t.app.inject({
      method: "PUT",
      url: `/api/v1/tasks/${ID}`,
      headers: { authorization: `Bearer ${token}` },
      payload: body(),
    });
    expect(res.statusCode).toBe(200);
    const list = await t.app.inject({
      method: "GET",
      url: "/api/v1/tasks/changes",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(list.json().tasks).toHaveLength(1);
  });
});

describe("minimum client version", () => {
  it("tells older clients to update, with the minimum", async () => {
    const t = await setup({ MIN_CLIENT_VERSION: "2.1.0" });
    for (const header of [
      "todo-desktop/2.0.9",
      "todo-desktop/1.9.9",
      "todo-desktop/2.0.0-beta.1",
    ]) {
      const res = await t.app.inject({
        method: "GET",
        url: "/api/v1/tasks/changes",
        cookies: t.cookie,
        headers: { "x-moli-client": header },
      });
      expect(res.statusCode).toBe(426);
      expect(res.json()).toMatchObject({
        error: { code: "upgrade_required" },
        minVersion: "2.1.0",
      });
    }
  });

  it("lets current clients, clients with no or odd headers, and non-API paths through", async () => {
    const t = await setup({ MIN_CLIENT_VERSION: "2.1.0" });
    for (const header of ["todo-desktop/2.1.0", "todo-desktop/3.0.0", "garbage", undefined]) {
      const res = await t.app.inject({
        method: "GET",
        url: "/api/v1/tasks/changes",
        cookies: t.cookie,
        headers: header ? { "x-moli-client": header } : {},
      });
      expect(res.statusCode).toBe(200);
    }
    const health = await t.app.inject({
      method: "GET",
      url: "/healthz",
      headers: { "x-moli-client": "todo-desktop/1.0.0" },
    });
    expect(health.statusCode).toBe(200);
  });

  it("applies no limit when not configured", async () => {
    const t = await setup();
    const res = await t.app.inject({
      method: "GET",
      url: "/api/v1/tasks/changes",
      cookies: t.cookie,
      headers: { "x-moli-client": "todo-desktop/0.0.1" },
    });
    expect(res.statusCode).toBe(200);
  });
});
