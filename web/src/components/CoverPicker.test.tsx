import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppContext } from "../context";
import { getSettings, uploadedCover } from "../lib/model";
import { createTodoStore, type TodoStore } from "../store";
import { createFakeApi, ME } from "../test-support/fake-api";
import { NOW, TODAY } from "../test-support/render-app";
import { CoverPicker } from "./CoverPicker";

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
    <AppContext.Provider value={{ engine: store.engine, me: ME, now: NOW, today: TODAY, tick }}>
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

  it("asks for a file when there is no picture of hers yet", () => {
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    setup(vi.fn());
    expect(screen.getByText("上传")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "换一张我的图片" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "上传图片" }));
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("shrinks and saves an uploaded picture, then switches between it and the paintings", async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
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
    expect(uploadedCover(store.engine)).toBe(IMAGE);
    expect(getSettings(store.engine).cover).toBe("upload");
    const mine = screen.getByRole("button", { name: "我的图片" });
    expect(mine.getAttribute("aria-pressed")).toBe("true");
    expect(mine.querySelector("img")?.getAttribute("src")).toBe(IMAGE);

    fireEvent.click(screen.getByRole("button", { name: "梵高《星月夜》" }));
    expect(getSettings(store.engine).cover).toBe("starry");
    fireEvent.click(mine);
    expect(getSettings(store.engine).cover).toBe("upload");
    expect(click).not.toHaveBeenCalled();
    // Already chosen: a tap picks another picture.
    fireEvent.click(mine);
    expect(click).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "换一张我的图片" }));
    expect(click).toHaveBeenCalledTimes(2);
  });

  it("says so when a picture cannot be used, and clears that on the next one", async () => {
    const compress = vi
      .fn<(file: Blob) => Promise<string>>()
      .mockRejectedValueOnce(new Error("too big"));
    compress.mockResolvedValueOnce(IMAGE);
    const store = setup(compress);
    choose([file()]);
    expect(await screen.findByText("这张图片用不了，换一张试试")).toBeTruthy();
    expect(screen.getByText("上传")).toBeTruthy();
    expect(uploadedCover(store.engine)).toBeNull();
    choose([file()]);
    await waitFor(() => expect(screen.queryByText("这张图片用不了，换一张试试")).toBeNull());
    await waitFor(() => expect(uploadedCover(store.engine)).toBe(IMAGE));
  });

  it("does nothing when no file was chosen", () => {
    const compress = vi.fn();
    setup(compress);
    choose([]);
    expect(compress).not.toHaveBeenCalled();
  });
});
