export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** How much of the window must be on a screen to count as reachable. */
const MIN_VISIBLE_WIDTH = 120;
const MIN_VISIBLE_HEIGHT = 44;

function overlap(a: Rect, b: Rect): { width: number; height: number } {
  return {
    width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)),
  };
}

/**
 * Keeps a saved window position reachable. After a screen was unplugged or its layout changed, a saved
 * position can lie outside every screen: then the window is centred on the first screen (the main one),
 * and made no bigger than that screen. A window that is mostly or partly still on a screen stays where it is.
 */
export function clampToVisible(rect: Rect, screens: Rect[]): Rect {
  const main = screens[0];
  if (!main) return rect;
  const reachable = screens.some((screen) => {
    const shown = overlap(rect, screen);
    return (
      shown.width >= Math.min(MIN_VISIBLE_WIDTH, rect.width) &&
      shown.height >= Math.min(MIN_VISIBLE_HEIGHT, rect.height)
    );
  });
  if (reachable) return rect;
  const width = Math.min(rect.width, main.width);
  const height = Math.min(rect.height, main.height);
  return {
    width,
    height,
    x: Math.round(main.x + (main.width - width) / 2),
    y: Math.round(main.y + (main.height - height) / 2),
  };
}
