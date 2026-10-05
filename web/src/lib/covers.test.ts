import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_COVER_LENGTH } from "@shared/records";
import {
  compressCover,
  COVER_HEIGHT,
  COVER_WIDTH,
  coverCrop,
  COVERS,
  coverSrc,
  fallbackChoice,
  UPLOAD,
  visibleCovers,
} from "./covers";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("coverSrc", () => {
  const mine = [
    { choice: UPLOAD, image: "data:image/jpeg;base64,AAAA" },
    { choice: "u:2", image: "data:image/jpeg;base64,BBBB" },
  ];

  it("uses her picture when she chose it and it is there", () => {
    expect(coverSrc(UPLOAD, mine)).toBe("data:image/jpeg;base64,AAAA");
    expect(coverSrc("u:2", mine)).toBe("data:image/jpeg;base64,BBBB");
  });

  it("falls back to the first painting for a missing upload or an unknown choice", () => {
    expect(coverSrc(UPLOAD, [])).toBe("/covers/monet.webp");
    expect(coverSrc("u:9", mine)).toBe("/covers/monet.webp");
    expect(coverSrc("gone", [])).toBe("/covers/monet.webp");
  });

  it("finds a painting by id", () => {
    expect(coverSrc("kiss", mine)).toBe("/covers/kiss.webp");
  });

  it("skips removed paintings, then falls back to her uploads", () => {
    expect(coverSrc("monet", [], ["monet"])).toBe("/covers/almond.webp");
    const all = COVERS.map((c) => c.id);
    expect(coverSrc("monet", mine, all)).toBe("data:image/jpeg;base64,AAAA");
    expect(coverSrc("monet", [], all)).toBe("/covers/monet.webp");
  });
});

describe("visibleCovers and fallbackChoice", () => {
  it("leaves out removed paintings", () => {
    expect(visibleCovers(["wave", "kiss"]).map((c) => c.id)).toEqual([
      "monet",
      "almond",
      "starry",
      "lilies",
      "parasol",
    ]);
    expect(visibleCovers()).toHaveLength(COVERS.length);
  });

  it("picks the first painting left, else an upload, else the first painting", () => {
    expect(fallbackChoice("monet", [], [])).toBe("almond");
    expect(fallbackChoice("u:1", [], ["monet"])).toBe("almond");
    const all = COVERS.map((c) => c.id);
    const mine = [
      { choice: "u:1", image: "a" },
      { choice: "u:2", image: "b" },
    ];
    expect(fallbackChoice("u:1", mine, all)).toBe("u:2");
    expect(fallbackChoice("u:1", [mine[0] as (typeof mine)[0]], all)).toBe("monet");
  });
});

describe("coverCrop", () => {
  it("cuts the sides off a wide picture", () => {
    expect(coverCrop(1200, 860)).toEqual({ sx: 300, sy: 0, sw: 600, sh: 860 });
  });

  it("cuts the top and bottom off a tall picture", () => {
    expect(coverCrop(600, 1720)).toEqual({ sx: 0, sy: 430, sw: 600, sh: 860 });
  });

  it("fills any box", () => {
    expect(coverCrop(400, 400, 100, 200)).toEqual({ sx: 100, sy: 0, sw: 200, sh: 400 });
  });
});

describe("compressCover", () => {
  function stubCanvas(
    urls: (quality: number) => string,
    context: unknown = { drawImage: vi.fn() }
  ) {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 1200, height: 860 }))
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      context as CanvasRenderingContext2D
    );
    const toDataURL = vi
      .spyOn(HTMLCanvasElement.prototype, "toDataURL")
      .mockImplementation((_type?: string, quality?: unknown) => urls(quality as number));
    return { context: context as { drawImage: ReturnType<typeof vi.fn> }, toDataURL };
  }

  it("draws the centred crop and lowers the quality until it fits", async () => {
    const big = "x".repeat(MAX_COVER_LENGTH + 1);
    const { context, toDataURL } = stubCanvas((quality) =>
      quality > 0.65 ? big : "data:image/jpeg;base64,AAAA"
    );
    const blob = new Blob(["x"]);
    await expect(compressCover(blob)).resolves.toBe("data:image/jpeg;base64,AAAA");
    expect(createImageBitmap).toHaveBeenCalledWith(blob);
    expect(context.drawImage).toHaveBeenCalledWith(
      { width: 1200, height: 860 },
      300,
      0,
      600,
      860,
      0,
      0,
      COVER_WIDTH,
      COVER_HEIGHT
    );
    expect(toDataURL.mock.calls.map((call) => call[1])).toEqual([0.85, 0.75, 0.62]);
    expect(toDataURL).toHaveBeenCalledWith("image/jpeg", 0.85);
  });

  it("gives up when even the lowest quality is too big", async () => {
    const { toDataURL } = stubCanvas(() => "x".repeat(MAX_COVER_LENGTH + 1));
    await expect(compressCover(new Blob(["x"]))).rejects.toThrow("too big");
    expect(toDataURL).toHaveBeenCalledTimes(5);
  });

  it("fails without a canvas", async () => {
    stubCanvas(() => "", null);
    await expect(compressCover(new Blob(["x"]))).rejects.toThrow("no canvas");
  });
});
