import { describe, expect, it } from "vitest";
import { createTestApp, APP_URL } from "../test-support/app.js";
import type { TaskData } from "@shared/records";

const task = (over: Partial<TaskData> = {}): TaskData => ({
  day: "2026-10-04",
  text: "R 21-1-3#阅读",
  indent: 0,
  done: false,
  doneAt: null,
  duration: null,
  highlight: null,
  position: "V",
  ...over,
});

const body = (data: unknown = task(), baseVersion = 0, deleted = false) => ({
  data,
  deleted,
  baseVersion,
});

const ID = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";

async function setup(config = {}) {
  const t = await createTestApp(config);
  const { cookie } = await t.signIn("alice");
  const put = (
    path: string,
    payload: unknown,
    who: Record<string, string> = cookie,
    headers: Record<string, string> = {}
  ) =>
    t.app.inject({
      method: "PUT",
      url: `/api/v2/records/${path}`,
      headers: { origin: APP_URL, ...headers },
      cookies: who,
      payload: payload as object,
    });
  const changes = (query = "", who: Record<string, string> = cookie) =>
    t.app.inject({ method: "GET", url: `/api/v2/changes${query}`, cookies: who });
  return { ...t, cookie, put, changes };
}

describe("records API", () => {
  it("requires sign-in", async () => {
    const t = await setup();
    expect((await t.app.inject({ method: "GET", url: "/api/v2/changes" })).statusCode).toBe(401);
    const put = await t.app.inject({
      method: "PUT",
      url: `/api/v2/records/task/${ID}`,
      headers: { origin: APP_URL },
      payload: body(),
    });
    expect(put.statusCode).toBe(401);
  });

  it("creates a record at version 1 and returns it in changes", async () => {
    const t = await setup();
    const res = await t.put(`task/${ID}`, body());
    expect(res.statusCode).toBe(200);
    expect(res.json().record).toEqual({
      kind: "task",
      id: ID,
      data: task(),
      deleted: false,
      version: 1,
    });
    const list = (await t.changes()).json();
    expect(list).toEqual({ records: [res.json().record], cursor: 1, hasMore: false });
  });

  it("keeps kinds apart: the same id under two kinds is two records", async () => {
    const t = await setup();
    await t.put("tag/阅读", body({ name: "阅读", color: "#3366cc" }));
    await t.put("settings/阅读", body({ accent: null, theme: "system", cover: "monet" }));
    const list = (await t.changes()).json();
    expect(list.records.map((r: { kind: string }) => r.kind)).toEqual(["tag", "settings"]);
  });

  it("drops fields the kind does not know", async () => {
    const t = await setup();
    const res = await t.put(`task/${ID}`, body({ ...task(), extra: 1 }));
    expect(res.json().record.data).toEqual(task());
  });

  it("raises the version on each change and moves the cursor", async () => {
    const t = await setup();
    await t.put(`task/${ID}`, body());
    await t.put(`task/${ID2}`, body(task({ text: "复盘", position: "W" })));
    const second = await t.put(`task/${ID}`, body(task({ done: true, doneAt: 5 }), 1));
    expect(second.json().record.version).toBe(2);
    const after = (await t.changes("?cursor=2")).json();
    expect(after.records.map((x: { id: string }) => x.id)).toEqual([ID]);
    expect(after.cursor).toBe(3);
    expect((await t.changes("?cursor=3")).json()).toEqual({
      records: [],
      cursor: 3,
      hasMore: false,
    });
  });

  it("pages changes with limit and hasMore", async () => {
    const t = await setup();
    for (let i = 0; i < 5; i += 1) {
      await t.put(`task/aaaaaaaa-0000-4000-8000-00000000000${i}`, body(task({ text: `t${i}` })));
    }
    const first = (await t.changes("?limit=2")).json();
    expect([first.records.length, first.hasMore]).toEqual([2, true]);
    const second = (await t.changes(`?limit=2&cursor=${first.cursor}`)).json();
    const third = (await t.changes(`?limit=2&cursor=${second.cursor}`)).json();
    expect([second.hasMore, third.hasMore, third.records.length]).toEqual([true, false, 1]);
  });

  it("answers 409 with the server's record when the base version is old", async () => {
    const t = await setup();
    await t.put(`task/${ID}`, body());
    await t.put(`task/${ID}`, body(task({ text: "改过了" }), 1));
    const stale = await t.put(`task/${ID}`, body(task({ text: "另一台的修改" }), 1));
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("conflict");
    expect(stale.json().record).toMatchObject({ data: { text: "改过了" }, version: 2 });
  });

  it("answers 409 with null for a base version of a record the server never had", async () => {
    const t = await setup();
    const res = await t.put(`task/${ID}`, body(task(), 3));
    expect(res.statusCode).toBe(409);
    expect(res.json().record).toBeNull();
  });

  it("treats a re-sent change as done, not as a conflict", async () => {
    const t = await setup();
    await t.put(`task/${ID}`, body());
    const again = await t.put(`task/${ID}`, body());
    expect(again.statusCode).toBe(200);
    expect(again.json().record.version).toBe(1);
    expect((await t.changes()).json().cursor).toBe(1);
  });

  it("keeps deletion markers and lets a deleted record come back", async () => {
    const t = await setup();
    await t.put(`task/${ID}`, body());
    await t.put(`task/${ID}`, body(task(), 1, true));
    expect((await t.changes("?cursor=1")).json().records[0]).toMatchObject({ deleted: true });
    const recreate = await t.put(`task/${ID}`, body());
    expect(recreate.statusCode).toBe(409);
    const back = await t.put(`task/${ID}`, body(task(), 2));
    expect(back.json().record).toMatchObject({ deleted: false, version: 3 });
  });

  it("keeps each person's records apart", async () => {
    const t = await setup();
    await t.put(`task/${ID}`, body());
    const bob = (await t.signIn("bob")).cookie;
    expect((await t.changes("", bob)).json().records).toEqual([]);
    expect((await t.put(`task/${ID}`, body(task({ text: "bob 的" })), bob)).statusCode).toBe(200);
    expect((await t.changes()).json().records[0].data.text).toBe("R 21-1-3#阅读");
  });

  it("accepts every kind's data", async () => {
    const t = await setup();
    const cases: [string, unknown][] = [
      [`tag/小作文`, { name: "小作文", color: null }],
      [
        `session/${ID}`,
        { name: "大作文", startedAt: 1, endedAt: 3601, seconds: 3600, day: "2026-10-04" },
      ],
      [`timer/current`, { name: "", startedAt: null, accumulated: 0, runningSince: null }],
      [`settings/settings`, { accent: "#a34e00", theme: "dark", cover: "upload" }],
      [`cover/cover`, { image: "data:image/jpeg;base64,AAAA" }],
    ];
    for (const [path, data] of cases) expect((await t.put(path, body(data))).statusCode).toBe(200);
  });

  it("rejects bad input", async () => {
    const t = await setup();
    const bad: [string, unknown][] = [
      [`task/${ID}`, body(task({ text: "x".repeat(2001) }))],
      [`task/${ID}`, body(task({ indent: 4 }))],
      [`task/${ID}`, body(task({ duration: 6001 }))],
      [`task/${ID}`, body(task({ day: "2026-13-01" }))],
      [`task/${ID}`, body(task({ position: "a0" }))],
      [`task/${ID}`, body({ ...task(), highlight: "pink" })],
      [`task/${ID}`, { data: task(), baseVersion: 0 }],
      [`tag/x`, body({ name: "x", color: "red" })],
      [`settings/settings`, body({ accent: "#ABCDEF", theme: "system", cover: "a" })],
      [`cover/cover`, body({ image: "javascript:alert(1)" })],
      [`cover/cover`, body({ image: `data:image/png;base64,${"A".repeat(600_000)}` })],
      [`note/${ID}`, body()],
      [`task/bad id`, body()],
      [`task/${"x".repeat(65)}`, body()],
    ];
    for (const [path, payload] of bad) {
      expect((await t.put(path, payload)).statusCode, path).toBe(400);
    }
    expect((await t.changes("?limit=0")).statusCode).toBe(400);
    expect((await t.changes("?limit=501")).statusCode).toBe(400);
    expect((await t.changes("?cursor=-1")).statusCode).toBe(400);
  });

  it("refuses writes from another origin", async () => {
    const t = await setup();
    const res = await t.put(`task/${ID}`, body(), t.cookie, { origin: "https://evil.example" });
    expect(res.statusCode).toBe(403);
  });

  it("tells pages from before the update to reload", async () => {
    const t = await setup();
    for (const method of ["GET", "PUT"] as const) {
      const res = await t.app.inject({
        method,
        url: `/api/v1/tasks/${method === "GET" ? "changes" : ID}`,
        headers: { origin: APP_URL },
        cookies: t.cookie,
        ...(method === "PUT" ? { payload: {} } : {}),
      });
      expect(res.statusCode).toBe(426);
      expect(res.json().error.code).toBe("upgrade_required");
    }
  });
});

describe("minimum client version", () => {
  it("tells older clients to update, with the minimum", async () => {
    const t = await setup({ MIN_CLIENT_VERSION: "3.1.0" });
    for (const header of ["todo-web/3.0.9", "todo-web/2.9.9", "todo-web/3.0.0-beta.1"]) {
      const res = await t.app.inject({
        method: "GET",
        url: "/api/v2/changes",
        cookies: t.cookie,
        headers: { "x-moli-client": header },
      });
      expect(res.statusCode).toBe(426);
      expect(res.json()).toMatchObject({
        error: { code: "upgrade_required" },
        minVersion: "3.1.0",
      });
    }
  });

  it("lets current clients, clients with no or odd headers, and non-API paths through", async () => {
    const t = await setup({ MIN_CLIENT_VERSION: "3.1.0" });
    for (const header of ["todo-web/3.1.0", "todo-web/4.0.0", "garbage", undefined]) {
      const res = await t.app.inject({
        method: "GET",
        url: "/api/v2/changes",
        cookies: t.cookie,
        headers: header ? { "x-moli-client": header } : {},
      });
      expect(res.statusCode).toBe(200);
    }
    const health = await t.app.inject({
      method: "GET",
      url: "/healthz",
      headers: { "x-moli-client": "todo-web/1.0.0" },
    });
    expect(health.statusCode).toBe(200);
  });

  it("applies no limit when not configured", async () => {
    const t = await setup();
    const res = await t.app.inject({
      method: "GET",
      url: "/api/v2/changes",
      cookies: t.cookie,
      headers: { "x-moli-client": "todo-web/0.0.1" },
    });
    expect(res.statusCode).toBe(200);
  });
});
