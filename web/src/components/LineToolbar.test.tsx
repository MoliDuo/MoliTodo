import {
  act,
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LineToolbar, type ToolbarLine } from "./LineToolbar";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const LINE: ToolbarLine = {
  mark: "box",
  indent: 0,
  highlight: null,
  highlightStyle: "fill",
  written: true,
};

function setup(line: Partial<ToolbarLine> = {}) {
  const props = {
    tags: [] as string[],
    onMark: vi.fn(),
    onIndent: vi.fn(),
    onHash: vi.fn(),
    onTag: vi.fn(),
    onHighlight: vi.fn(),
    onImages: vi.fn(),
    onMore: vi.fn(),
  };
  render(<LineToolbar line={{ ...LINE, ...line }} {...props} />);
  return props;
}

const bar = () => screen.getByRole("toolbar").parentElement?.parentElement as HTMLElement;

/** A phone's visual viewport, which shrinks when the keyboard opens. */
function viewport(height: number) {
  const listeners = new Map<string, () => void>();
  const vv = {
    height,
    offsetTop: 0,
    addEventListener: (type: string, fn: () => void) => listeners.set(type, fn),
    removeEventListener: (type: string) => listeners.delete(type),
  };
  vi.stubGlobal("visualViewport", vv);
  return { vv, fire: (type: string) => act(() => listeners.get(type)?.()), listeners };
}

describe("LineToolbar", () => {
  it("sits above the bottom bar without a keyboard, and on top of the keyboard with one", () => {
    vi.stubGlobal("innerHeight", 800);
    const { vv, fire, listeners } = viewport(800);
    setup();
    expect(bar().style.bottom).toBe("");
    expect(bar().className).toContain("bottom-[calc(3.5rem");
    vv.height = 500;
    fire("resize");
    expect(bar().style.bottom).toBe("300px");
    vv.offsetTop = 40;
    fire("scroll");
    expect(bar().style.bottom).toBe("260px");
    cleanup();
    expect(listeners.size).toBe(0);
  });

  it("keeps the caret in the line when pressed with a mouse", () => {
    setup();
    const tag = screen.getByRole("button", { name: "标签" });
    const down = createEvent.mouseDown(tag);
    fireEvent(tag, down);
    expect(down.defaultPrevented).toBe(true);
  });

  it("opens and closes the highlight colours; a style with no colour yet starts with yellow", () => {
    const props = setup();
    const highlight = screen.getByRole("button", { name: "高亮" });
    fireEvent.click(highlight);
    const group = screen.getByRole("group", { name: "高亮颜色" });
    fireEvent.click(within(group).getByRole("button", { name: "下划线" }));
    expect(props.onHighlight).toHaveBeenCalledWith("yellow", "underline");
    fireEvent.click(highlight);
    expect(screen.queryByRole("group", { name: "高亮颜色" })).toBeNull();
  });

  it("keeps the colour when the style changes", () => {
    const props = setup({ highlight: "green", highlightStyle: "underline" });
    fireEvent.click(screen.getByRole("button", { name: "高亮" }));
    const group = screen.getByRole("group", { name: "高亮颜色" });
    expect(within(group).getByRole("button", { name: "下划线" }).getAttribute("aria-pressed")).toBe(
      "true"
    );
    fireEvent.click(within(group).getByRole("button", { name: "底色" }));
    expect(props.onHighlight).toHaveBeenCalledWith("green", "fill");
  });

  it("offers tags and stops indenting at the limit", () => {
    const props = { ...setup({ indent: 3 }) };
    expect((screen.getByRole("button", { name: "缩进" }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    const more = vi.fn();
    render(
      <LineToolbar
        line={LINE}
        tags={["阅读"]}
        onMark={props.onMark}
        onIndent={props.onIndent}
        onHash={props.onHash}
        onTag={props.onTag}
        onHighlight={props.onHighlight}
        onImages={props.onImages}
        onMore={more}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "#阅读" }));
    expect(props.onTag).toHaveBeenCalledWith("阅读");
    fireEvent.click(screen.getByRole("button", { name: "更多" }));
    expect(more).toHaveBeenCalled();
  });
});
