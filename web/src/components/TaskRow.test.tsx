import { afterEach, describe, expect, it } from "vitest";
import { caretFromPoint } from "./TaskRow";

/** jsdom has neither; each test puts on the one it needs. */
const doc = document as unknown as Record<string, unknown>;

afterEach(() => {
  delete doc.caretPositionFromPoint;
  delete doc.caretRangeFromPoint;
  document.body.innerHTML = "";
});

/** "复盘" then a tag in its own span, like the copy of a line drawn under its text box. */
function copy() {
  const container = document.createElement("span");
  container.innerHTML = "复盘<span>#阅读</span>";
  document.body.append(container);
  const tag = (container.lastChild as HTMLElement).firstChild as Text;
  return { container, tag };
}

describe("caretFromPoint", () => {
  it("counts through the copy's text to the point, with caretPositionFromPoint", () => {
    const { container, tag } = copy();
    doc.caretPositionFromPoint = () => ({ offsetNode: tag, offset: 1 });
    expect(caretFromPoint(container, 5, 5)).toBe(3);
  });

  it("uses caretRangeFromPoint where that is what there is", () => {
    const { container } = copy();
    const first = container.firstChild as Text;
    doc.caretRangeFromPoint = () => ({ startContainer: first, startOffset: 2 });
    expect(caretFromPoint(container, 5, 5)).toBe(2);
  });

  it("gives null off the text, outside the copy, or with no way to tell", () => {
    const { container } = copy();
    expect(caretFromPoint(container, 5, 5)).toBeNull();
    doc.caretPositionFromPoint = () => null;
    expect(caretFromPoint(container, 5, 5)).toBeNull();
    const elsewhere = document.createTextNode("别处");
    document.body.append(elsewhere);
    doc.caretPositionFromPoint = () => ({ offsetNode: elsewhere, offset: 1 });
    expect(caretFromPoint(container, 5, 5)).toBeNull();
  });
});
