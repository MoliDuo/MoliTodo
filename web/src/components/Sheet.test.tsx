import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Sheet } from "./Sheet";

afterEach(cleanup);

function Harness({ onClose }: { onClose: () => void }) {
  const [count, setCount] = useState(0);
  return (
    <>
      <button type="button" onClick={() => setCount((c) => c + 1)}>
        rerender {count}
      </button>
      <Sheet title="用时" onClose={() => onClose()}>
        <input aria-label="分钟" />
      </Sheet>
    </>
  );
}

describe("Sheet", () => {
  it("keeps focus in its input when the page re-renders with a new onClose", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const input = screen.getByLabelText("分钟");
    input.focus();
    fireEvent.click(screen.getByText(/rerender/));
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("is wider on wide screens when asked", () => {
    render(
      <Sheet title="宽" onClose={() => {}} wide>
        x
      </Sheet>
    );
    expect(screen.getByRole("dialog").className).toContain("sm:max-w-lg");
  });
});
