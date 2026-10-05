import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Calendar } from "./Calendar";

afterEach(cleanup);

describe("Calendar", () => {
  it("lets every day be picked when no days are singled out", () => {
    const onPick = vi.fn();
    render(
      <Calendar selected="2026-10-04" today="2026-10-04" marked={new Set()} onPick={onPick} />
    );
    expect(screen.queryByRole("button", { name: /换一年/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "2026-10-09" }));
    expect(onPick).toHaveBeenCalledWith("2026-10-09");
  });

  it("jumps to a year, staying in the same month when nothing there can be picked", () => {
    render(
      <Calendar
        selected="2026-10-04"
        today="2026-10-04"
        marked={new Set()}
        years={[2026, 2024]}
        onPick={() => {}}
      />
    );
    const title = screen.getByRole("button", { name: "2026年10月，换一年" });
    fireEvent.click(title);
    expect(title.getAttribute("aria-expanded")).toBe("true");
    expect(screen.queryByRole("button", { name: "2026-10-09" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "2024" }));
    expect(screen.getByText("2024年10月")).toBeTruthy();
    expect(screen.getByRole("button", { name: "2024-10-09" })).toBeTruthy();
  });
});
