import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageViewer } from "./ImageViewer";

afterEach(cleanup);

function Harness({ start, onClose }: { start: string; onClose: () => void }) {
  const [files, setFiles] = useState(["a", "b", "c"]);
  return (
    <ImageViewer
      files={files}
      start={start}
      onClose={onClose}
      onDelete={(file) => setFiles((list) => list.filter((f) => f !== file))}
    />
  );
}

const src = () => screen.getByRole("dialog").querySelector("img")?.getAttribute("src");
const counter = () => screen.getByText(/ \/ /).textContent;

describe("ImageViewer", () => {
  it("steps through the pictures with the buttons and the arrow keys", () => {
    render(<Harness start="b" onClose={() => {}} />);
    expect(src()).toBe("/api/v2/files/b");
    expect(counter()).toBe("2 / 3");
    fireEvent.click(screen.getByRole("button", { name: "下一张" }));
    expect(counter()).toBe("3 / 3");
    expect(screen.queryByRole("button", { name: "下一张" })).toBeNull();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(counter()).toBe("3 / 3");
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(counter()).toBe("1 / 3");
    expect(screen.queryByRole("button", { name: "上一张" })).toBeNull();
  });

  it("closes on the cross, a tap beside the picture or Esc, but not a tap on it", () => {
    const onClose = vi.fn();
    render(<Harness start="a" onClose={onClose} />);
    fireEvent.click(screen.getByRole("dialog").querySelector("img") as HTMLImageElement);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(
      (screen.getByRole("dialog").querySelector("img") as HTMLElement).parentElement as HTMLElement
    );
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("asks before deleting, steps back from the last one, and closes when none is left", () => {
    const onClose = vi.fn();
    render(<Harness start="c" onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /删除图片/ }));
    fireEvent.click(screen.getByRole("button", { name: "留着" }));
    expect(counter()).toBe("3 / 3");
    fireEvent.click(screen.getByRole("button", { name: /删除图片/ }));
    fireEvent.click(screen.getByRole("button", { name: "删除这张" }));
    expect(src()).toBe("/api/v2/files/b");
    expect(counter()).toBe("2 / 2");
    fireEvent.click(screen.getByRole("button", { name: /删除图片/ }));
    fireEvent.click(screen.getByRole("button", { name: "删除这张" }));
    expect(src()).toBe("/api/v2/files/a");
    fireEvent.click(screen.getByRole("button", { name: /删除图片/ }));
    fireEvent.click(screen.getByRole("button", { name: "删除这张" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
