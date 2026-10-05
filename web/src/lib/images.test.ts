import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_FILE_BYTES } from "@shared/records";
import { compressImage, createFileApi, fileUrl, fitWithin, UploadError } from "./images";

const ID = "11111111-1111-4111-8111-111111111111";
const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("fitWithin", () => {
  it("shrinks the longest side to the limit and never enlarges", () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(1000, 3200)).toEqual({ width: 500, height: 1600 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });
});

describe("compressImage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function stub(context: unknown, blob: Blob | null) {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 3200, height: 1600 }))
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      context as CanvasRenderingContext2D
    );
    const toBlob = vi
      .spyOn(HTMLCanvasElement.prototype, "toBlob")
      .mockImplementation((done) => done(blob));
    return toBlob;
  }

  it("draws the picture at most 1600px on its longest side and saves a JPEG", async () => {
    const drawImage = vi.fn();
    const jpeg = new Blob(["j"], { type: "image/jpeg" });
    const toBlob = stub({ drawImage }, jpeg);
    expect(await compressImage(new Blob(["x"]))).toBe(jpeg);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1600, 800);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", 0.82);
  });

  it("fails without a canvas or when nothing comes out", async () => {
    stub(null, null);
    await expect(compressImage(new Blob(["x"]))).rejects.toThrow("no canvas");
    vi.restoreAllMocks();
    stub({ drawImage: vi.fn() }, null);
    await expect(compressImage(new Blob(["x"]))).rejects.toThrow("no blob");
  });
});

describe("createFileApi", () => {
  it("sends the shrunk picture and returns its id", async () => {
    const small = new Blob(["s"], { type: "image/jpeg" });
    const fetchFn = vi.fn(async () => ok({ id: ID }));
    const api = createFileApi(
      "todo-web/1.0.0",
      fetchFn as unknown as typeof fetch,
      async () => small
    );
    expect(await api.upload(new Blob(["big"], { type: "image/png" }))).toBe(ID);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/v2/files");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(small);
    expect(init.headers).toMatchObject({
      "content-type": "image/jpeg",
      "x-moli-client": "todo-web/1.0.0",
    });
  });

  it("sends the original when it cannot be shrunk, if the server takes that kind", async () => {
    const fetchFn = vi.fn(async () => ok({ id: ID }));
    const fail = async () => {
      throw new Error("no canvas");
    };
    const api = createFileApi("c", fetchFn as unknown as typeof fetch, fail);
    const png = new Blob(["p"], { type: "image/png" });
    expect(await api.upload(png)).toBe(ID);
    expect((fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body).toBe(png);
    await expect(api.upload(new Blob(["g"], { type: "image/gif" }))).rejects.toEqual(
      new UploadError("unsupported")
    );
    const huge = new Blob([new Uint8Array(MAX_FILE_BYTES + 1)], { type: "image/png" });
    await expect(api.upload(huge)).rejects.toEqual(new UploadError("unsupported"));
  });

  it("tells offline, too big and other failures apart", async () => {
    const same = async (file: Blob) => file;
    const pic = new Blob(["p"], { type: "image/jpeg" });
    const offline = createFileApi(
      "c",
      (async () => {
        throw new TypeError("network");
      }) as unknown as typeof fetch,
      same
    );
    await expect(offline.upload(pic)).rejects.toMatchObject({ reason: "offline" });
    const big = createFileApi("c", (async () => ok({}, 413)) as unknown as typeof fetch, same);
    await expect(big.upload(pic)).rejects.toMatchObject({ reason: "unsupported" });
    const odd = createFileApi("c", (async () => ok({ nope: 1 })) as unknown as typeof fetch, same);
    await expect(odd.upload(pic)).rejects.toMatchObject({ reason: "failed" });
    const down = createFileApi("c", (async () => ok({}, 500)) as unknown as typeof fetch, same);
    await expect(down.upload(pic)).rejects.toMatchObject({ reason: "failed" });
  });

  it("deletes, ignoring failures", async () => {
    const fetchFn = vi.fn(async () => ok({ ok: true }));
    await createFileApi("c", fetchFn as unknown as typeof fetch).remove(ID);
    expect(fetchFn).toHaveBeenCalledWith(
      fileUrl(ID),
      expect.objectContaining({ method: "DELETE" })
    );
    const broken = createFileApi("c", (async () => {
      throw new TypeError("x");
    }) as unknown as typeof fetch);
    await expect(broken.remove(ID)).resolves.toBeUndefined();
  });
});
