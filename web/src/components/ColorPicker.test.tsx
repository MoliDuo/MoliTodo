import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ColorPicker } from "./ColorPicker";

afterEach(cleanup);

const BAD = "不是色号，要像 #a34e00 这样（6 位，0-9 和 a-f）";
const codeBox = () => screen.getByRole("textbox", { name: "色号" });
const submit = () => fireEvent.click(screen.getByRole("button", { name: "用这个" }));

describe("ColorPicker", () => {
  it("marks the chosen preset and picks another one", () => {
    const onChange = vi.fn();
    render(<ColorPicker value="#3f7d5c" onChange={onChange} />);
    const pine = screen.getByRole("button", { name: "松针" });
    expect(pine.getAttribute("aria-pressed")).toBe("true");
    expect(pine.querySelector("svg")).not.toBeNull();
    const amber = screen.getByRole("button", { name: "琥珀" });
    expect(amber.getAttribute("aria-pressed")).toBe("false");
    expect(amber.querySelector("svg")).toBeNull();
    expect(amber.getAttribute("title")).toBe("琥珀 #a34e00");
    fireEvent.click(amber);
    expect(onChange).toHaveBeenCalledWith("#a34e00");
    expect(codeBox()).toHaveProperty("value", "#3f7d5c");
  });

  it("has no clearing swatch without a label for it", () => {
    render(<ColorPicker value={null} onChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "跟主题色" })).toBeNull();
    expect(codeBox()).toHaveProperty("value", "");
    expect(screen.getByLabelText("取色器")).toHaveProperty("value", "#a34e00");
  });

  it("clears the colour with the first swatch", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ColorPicker value="#4466bb" onChange={onChange} noneLabel="跟主题色" />
    );
    const none = screen.getByRole("button", { name: "跟主题色" });
    expect(none.getAttribute("aria-pressed")).toBe("false");
    expect(none.className).not.toContain("ring-2");
    fireEvent.click(none);
    expect(onChange).toHaveBeenCalledWith(null);
    rerender(<ColorPicker value={null} onChange={onChange} noneLabel="跟主题色" />);
    expect(none.getAttribute("aria-pressed")).toBe("true");
    expect(none.className).toContain("ring-2");
    expect(codeBox()).toHaveProperty("value", "");
  });

  it("says so when the code is not a colour, and forgets it once edited", () => {
    const onChange = vi.fn();
    render(<ColorPicker value={null} onChange={onChange} />);
    fireEvent.change(codeBox(), { target: { value: "#zzz" } });
    submit();
    expect(screen.getByText(BAD)).toBeTruthy();
    expect(codeBox().getAttribute("aria-invalid")).toBe("true");
    expect(codeBox().className).toContain("ring-danger");
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(codeBox(), { target: { value: "#zz" } });
    expect(screen.queryByText(BAD)).toBeNull();
    expect(codeBox().getAttribute("aria-invalid")).toBe("false");
  });

  it("treats an empty code as not a colour when there is no way to clear", () => {
    const onChange = vi.fn();
    render(<ColorPicker value="#a34e00" onChange={onChange} />);
    fireEvent.change(codeBox(), { target: { value: "  " } });
    submit();
    expect(screen.getByText(BAD)).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("clears the colour when the code is emptied and there is a way to clear", () => {
    const onChange = vi.fn();
    render(<ColorPicker value="#a34e00" onChange={onChange} noneLabel="跟主题色" />);
    fireEvent.change(codeBox(), { target: { value: "" } });
    submit();
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("uses a typed code, written any way", () => {
    const onChange = vi.fn();
    render(<ColorPicker value={null} onChange={onChange} />);
    fireEvent.change(codeBox(), { target: { value: "#4466BB" } });
    expect(screen.getByLabelText("取色器")).toHaveProperty("value", "#4466bb");
    submit();
    expect(onChange).toHaveBeenLastCalledWith("#4466bb");
    fireEvent.change(codeBox(), { target: { value: "abc" } });
    submit();
    expect(onChange).toHaveBeenLastCalledWith("#aabbcc");
  });

  it("uses the code on blur only when it changed", () => {
    const onChange = vi.fn();
    render(<ColorPicker value="#a34e00" onChange={onChange} />);
    fireEvent.blur(codeBox());
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(codeBox(), { target: { value: "8a6bb0" } });
    fireEvent.blur(codeBox());
    expect(onChange).toHaveBeenCalledWith("#8a6bb0");
  });

  it("checks the code on blur too", () => {
    const onChange = vi.fn();
    render(<ColorPicker value={null} onChange={onChange} />);
    fireEvent.change(codeBox(), { target: { value: "nope" } });
    fireEvent.blur(codeBox());
    expect(screen.getByText(BAD)).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("uses the system colour picker", () => {
    const onChange = vi.fn();
    render(<ColorPicker value={null} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("取色器"), { target: { value: "#123456" } });
    expect(onChange).toHaveBeenCalledWith("#123456");
    expect(codeBox()).toHaveProperty("value", "#123456");
  });

  it("shows a new value given from outside and drops the error", () => {
    const onChange = vi.fn();
    const { rerender } = render(<ColorPicker value={null} onChange={onChange} />);
    fireEvent.change(codeBox(), { target: { value: "bad!" } });
    submit();
    expect(screen.getByText(BAD)).toBeTruthy();
    rerender(<ColorPicker value="#b04a6c" onChange={onChange} />);
    expect(screen.queryByText(BAD)).toBeNull();
    expect(codeBox()).toHaveProperty("value", "#b04a6c");
    expect(screen.getByLabelText("取色器")).toHaveProperty("value", "#b04a6c");
  });

  it("previews the value while the code is half typed", () => {
    render(<ColorPicker value="#5b6170" onChange={vi.fn()} />);
    fireEvent.change(codeBox(), { target: { value: "#5b" } });
    expect(screen.getByLabelText("取色器")).toHaveProperty("value", "#5b6170");
  });
});
