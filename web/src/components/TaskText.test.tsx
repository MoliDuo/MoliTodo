import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TaskData } from "@shared/records";
import { TaskLine, TaskMark, TaskWords } from "./TaskText";

afterEach(cleanup);

const task = (over: Partial<TaskData> = {}): TaskData => ({
  day: "2026-10-04",
  text: "R 21-1-3#阅读 复盘",
  indent: 1,
  done: false,
  doneAt: null,
  duration: null,
  highlight: null,
  position: "V",
  ...over,
});

describe("TaskWords", () => {
  it("colours tags and puts the highlight behind", () => {
    const { container } = render(
      <TaskWords text="读 #书" highlight="blue" tagColors={new Map([["书", "#112233"]])} muted />
    );
    const tag = [...container.querySelectorAll("span")].find(
      (s) => s.textContent === "#书"
    ) as HTMLElement;
    expect(tag.style.color).toBe("rgb(17, 34, 51)");
    expect(tag.className).toBe("opacity-80");
    expect(container.querySelector(".hl-blue")?.textContent).toBe("读 #书");
  });
});

describe("TaskMark", () => {
  it("draws a box, or a tick once done", () => {
    const { container, rerender } = render(<TaskMark done={false} size={14} />);
    expect((container.firstElementChild as HTMLElement).style.width).toBe("10px");
    rerender(<TaskMark done />);
    expect(container.querySelector("svg")).not.toBeNull();
  });
});

describe("TaskLine", () => {
  it("reads as plain text, indented", () => {
    const { container } = render(<TaskLine task={task()} tagColors={new Map()} />);
    const line = container.firstElementChild as HTMLElement;
    expect(line.tagName).toBe("DIV");
    expect(line.style.paddingLeft).toBe("24px");
    expect(line.className).toContain("text-[15px]");
    expect(line.textContent).toBe("R 21-1-3#阅读 复盘");
  });

  it("shows the time of a finished task and opens when it can", () => {
    const onOpen = vi.fn();
    render(
      <TaskLine
        task={task({ done: true, duration: 73, indent: 2 })}
        tagColors={new Map()}
        small
        onOpen={onOpen}
      />
    );
    const button = screen.getByRole("button");
    expect(button.style.paddingLeft).toBe("32px");
    expect(button.className).toContain("text-[13px]");
    expect(button.textContent).toContain("1h13min");
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("leaves the time out when none was given", () => {
    const { container } = render(<TaskLine task={task({ done: true })} tagColors={new Map()} />);
    expect(container.textContent).toBe("R 21-1-3#阅读 复盘");
  });
});
