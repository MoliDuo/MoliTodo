// How big the day list's text is. Each device keeps its own choice (a phone and a laptop want different sizes),
// so it lives in this browser only and is not synced.

export const LIST_SIZES = [
  { px: 15, label: "小" },
  { px: 16, label: "标准" },
  { px: 17, label: "大" },
  { px: 18, label: "特大" },
] as const;

export const DEFAULT_LIST_SIZE = 16;
export const LIST_SIZE_KEY = "moli-todo:list-size";

/** A stored value as a size we offer; anything else is the default. */
export function parseListSize(value: string | null): number {
  const px = Number(value);
  return LIST_SIZES.some((size) => size.px === px) ? px : DEFAULT_LIST_SIZE;
}

/** Line height for a text size: roomy enough for a highlight and an underline, on whole pixels. */
export const listLeading = (px: number): number => Math.round(px * 1.6);

/** Puts the size on the page, where the list's CSS reads it. */
export function applyListSize(px: number, doc: Document = document): void {
  const style = doc.documentElement.style;
  style.setProperty("--list-size", `${px}px`);
  style.setProperty("--list-leading", `${listLeading(px)}px`);
}
