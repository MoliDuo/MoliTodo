import { describe, expect, it } from "vitest";
import { MAX_FILE_BYTES } from "@shared/records";
import { APP_URL, createTestApp } from "../test-support/app.js";

const PICTURE = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

async function setup() {
  const t = await createTestApp();
  const alice = (await t.signIn("alice")).cookie;
  const bob = (await t.signIn("bob")).cookie;
  const upload = (
    payload: Buffer,
    type = "image/jpeg",
    who: Record<string, string> = alice,
    headers: Record<string, string> = { origin: APP_URL }
  ) =>
    t.app.inject({
      method: "POST",
      url: "/api/v2/files",
      headers: { ...headers, "content-type": type },
      cookies: who,
      payload,
    });
  const get = (id: string, who: Record<string, string> = alice) =>
    t.app.inject({ method: "GET", url: `/api/v2/files/${id}`, cookies: who });
  const remove = (id: string, who: Record<string, string> = alice) =>
    t.app.inject({
      method: "DELETE",
      url: `/api/v2/files/${id}`,
      headers: { origin: APP_URL },
      cookies: who,
    });
  return { ...t, alice, bob, upload, get, remove };
}

describe("files API", () => {
  it("keeps a picture and gives it back to its owner", async () => {
    const t = await setup();
    const res = await t.upload(PICTURE);
    expect(res.statusCode).toBe(200);
    const { id } = res.json() as { id: string };
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    const back = await t.get(id);
    expect(back.statusCode).toBe(200);
    expect(back.headers["content-type"]).toBe("image/jpeg");
    expect(back.headers["cache-control"]).toContain("immutable");
    expect(back.rawPayload.equals(PICTURE)).toBe(true);
  });

  it("does not show one person's picture to another", async () => {
    const t = await setup();
    const { id } = (await t.upload(PICTURE)).json() as { id: string };
    expect((await t.get(id, t.bob)).statusCode).toBe(404);
    expect((await t.remove(id, t.bob)).statusCode).toBe(200);
    expect((await t.get(id)).statusCode).toBe(200);
  });

  it("deletes a picture", async () => {
    const t = await setup();
    const { id } = (await t.upload(PICTURE, "image/png")).json() as { id: string };
    expect((await t.remove(id)).statusCode).toBe(200);
    expect((await t.get(id)).statusCode).toBe(404);
  });

  it("requires sign-in and our own origin", async () => {
    const t = await setup();
    expect((await t.upload(PICTURE, "image/jpeg", {})).statusCode).toBe(401);
    expect((await t.get("11111111-1111-4111-8111-111111111111", {})).statusCode).toBe(401);
    const foreign = await t.upload(PICTURE, "image/jpeg", t.alice, {
      origin: "https://evil.example.com",
    });
    expect(foreign.statusCode).toBe(403);
  });

  it("takes only pictures, not empty and not too big", async () => {
    const t = await setup();
    expect((await t.upload(PICTURE, "text/plain")).statusCode).toBeGreaterThanOrEqual(400);
    expect((await t.upload(PICTURE, "image/gif")).statusCode).toBeGreaterThanOrEqual(400);
    expect((await t.upload(Buffer.alloc(0))).statusCode).toBe(400);
    expect((await t.upload(Buffer.alloc(MAX_FILE_BYTES + 1, 1))).statusCode).toBe(413);
    expect((await t.get("not-an-id")).statusCode).toBe(400);
  });
});
