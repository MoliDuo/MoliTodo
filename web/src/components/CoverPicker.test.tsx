import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppContext } from "../context";
import { getSettings, uploadedCovers } from "../lib/model";
import { LONG_PRESS_MS } from "../lib/reorder";
import { createTodoStore, type TodoStore } from "../store";
import { createFakeApi, ME } from "../test-support/fake-api";
import { NOW, TODAY } from "../test-support/render-app";
import { CaseColorPicker, CoverPicker } from "./CoverPicker";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const IMAGE = "data:image/jpeg;base64,AAAA";

function Harness({
  store,
  compress,
}: {
  store: TodoStore;
  compress: (file: Blob) => Promise<string>;
}) {
  const tick = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return (
    <AppContext.Provider
      value={{ engine: store.engine, files: store.files, me: ME, now: NOW, today: TODAY, tick }}
    >
      <CaseColorPicker />
      <CoverPicker compress={compress} />
    </AppContext.Provider>
  );
}

function setup(compress: (file: Blob) => Promise<string>) {
  const store = createTodoStore(createFakeApi().fetch);
  render(<Harness store={store} compress={compress} />);
  return store;
}

const input = () => screen.getByLabelText("选择图片") as HTMLInputElement;
const choose = (files: File[]) => fireEvent.change(input(), { target: { files } });
const file = () => new File(["x"], "me.png", { type: "image/png" });

describe("CoverPicker", () => {
  it("picks a painting", () => {
    const store = setup(vi.fn());
    const kiss = screen.getByRole("button", { name: "克里姆特《吻》" });
    expect(kiss.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(kiss);
    expect(kiss.getAttribute("aria-pressed")).toBe("true");
    expect(getSettings(store.engine).cover).toBe("kiss");
  });

  it("asks for a file from the upload tile", () => {
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    setup(vi.fn());
    expect(screen.getByText("上传")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "上传图片" }));
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("shrinks and keeps uploaded pictures, choosing each new one", async () => {
    let resolve: (value: string) => void = () => {};
    const compress = vi.fn(() => new Promise<string>((r) => (resolve = r)));
    const store = setup(compress);
    const picture = file();
    choose([picture]);
    expect(compress).toHaveBeenCalledWith(picture);
    expect(input().value).toBe("");
    expect(screen.getByText("处理中…")).toBeTruthy();
    resolve(IMAGE);
    await waitFor(() => expect(screen.getByRole("button", { name: "我的图片" })).toBeTruthy());
    const [first] = uploadedCovers(store.engine);
    expect(first?.image).toBe(IMAGE);
    expect(getSettings(store.engine).cover).toBe(first?.choice);
    const mine = screen.getByRole("button", { name: "我的图片" });
    expect(mine.getAttribute("aria-pressed")).toBe("true");
    expect(mine.querySelector("img")?.getAttribute("src")).toBe(IMAGE);

    fireEvent.click(screen.getByRole("button", { name: "梵高《星月夜》" }));
    expect(getSettings(store.engine).cover).toBe("starry");
    fireEvent.click(mine);
    expect(getSettings(store.engine).cover).toBe(first?.choice);

    // A second picture sits next to the first, and the upload tile stays last.
    choose([file()]);
    resolve("data:image/jpeg;base64,BBBB");
    await waitFor(() => expect(screen.getByRole("button", { name: "我的图片 2" })).toBeTruthy());
    expect(uploadedCovers(store.engine)).toHaveLength(2);
    expect(screen.getByRole("button", { name: "我的图片 2" }).getAttribute("aria-pressed")).toBe(
      "true"
    );
    const tiles = screen.getAllByRole("listitem");
    expect(tiles.at(-1)?.textContent).toContain("上传");
  });

  it("says so when a picture cannot be used, and clears that on the next one", async () => {
    const compress = vi
      .fn<(file: Blob) => Promise<string>>()
      .mockRejectedValueOnce(new Error("too big"));
    compress.mockResolvedValueOnce(IMAGE);
    const store = setup(compress);
    choose([file()]);
    expect(await screen.findByText("这张图片用不了，换一张试试")).toBeTruthy();
    expect(uploadedCovers(store.engine)).toEqual([]);
    choose([file()]);
    await waitFor(() => expect(screen.queryByText("这张图片用不了，换一张试试")).toBeNull());
    await waitFor(() => expect(uploadedCovers(store.engine)[0]?.image).toBe(IMAGE));
  });

  it("deletes a painting after a long press, picks another, and brings the paintings back", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const store = setup(vi.fn());
      const monet = screen.getByRole("button", { name: "莫奈《鲁昂大教堂》" });
      expect(monet.getAttribute("aria-pressed")).toBe("true");
      fireEvent.pointerDown(monet, { button: 0, clientX: 10, clientY: 10 });
      act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
      fireEvent.pointerUp(monet);
      // The tap that ends a long press does not choose the cover.
      fireEvent.click(monet);
      fireEvent.click(screen.getByRole("button", { name: "删除鲁昂大教堂" }));
      expect(screen.queryByRole("button", { name: "莫奈《鲁昂大教堂》" })).toBeNull();
      expect(getSettings(store.engine)).toMatchObject({ cover: "almond", hiddenCovers: ["monet"] });

      // A right click asks too; a tap elsewhere puts the button away.
      fireEvent.contextMenu(screen.getByRole("button", { name: "克里姆特《吻》" }));
      expect(screen.getByRole("button", { name: "删除吻" })).toBeTruthy();
      fireEvent.pointerDown(document.body);
      expect(screen.queryByRole("button", { name: "删除吻" })).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "恢复名画" }));
      expect(screen.getByRole("button", { name: "莫奈《鲁昂大教堂》" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "恢复名画" })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not offer to delete on a right-button press, a press that moves, or twice", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      setup(vi.fn());
      const wave = screen.getByRole("button", { name: "葛饰北斋《神奈川冲浪里》" });
      fireEvent.pointerDown(wave, { button: 2, clientX: 10, clientY: 10 });
      act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
      fireEvent.pointerDown(wave, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerMove(wave, { clientX: 10, clientY: 40 });
      act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
      expect(screen.queryByRole("button", { name: "删除神奈川冲浪里" })).toBeNull();

      fireEvent.pointerDown(wave, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.pointerMove(wave, { clientX: 12, clientY: 11 });
      act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
      // The context menu a long press also brings does not ask again.
      fireEvent.contextMenu(wave);
      const remove = screen.getByRole("button", { name: "删除神奈川冲浪里" });
      // Pressing the delete button itself does not put it away.
      fireEvent.pointerDown(remove);
      expect(screen.getByRole("button", { name: "删除神奈川冲浪里" })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("deletes an uploaded picture", async () => {
    const store = setup(vi.fn(async () => IMAGE));
    choose([file()]);
    const mine = await screen.findByRole("button", { name: "我的图片" });
    fireEvent.contextMenu(mine);
    fireEvent.click(screen.getByRole("button", { name: "删除我的图片" }));
    expect(uploadedCovers(store.engine)).toEqual([]);
    expect(getSettings(store.engine).cover).toBe("monet");
  });

  it("sets the case colour apart from the theme colour", () => {
    const store = setup(vi.fn());
    const same = screen.getByRole("button", { name: "跟主题色一样" });
    expect(same.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "湖水" }));
    expect(getSettings(store.engine).caseColor).toBe("#2f7f8f");
    expect(getSettings(store.engine).accent).toBeNull();
    fireEvent.click(same);
    expect(getSettings(store.engine).caseColor).toBeNull();
  });

  it("does nothing when no file was chosen", () => {
    const compress = vi.fn();
    setup(compress);
    choose([]);
    expect(compress).not.toHaveBeenCalled();
  });
});
