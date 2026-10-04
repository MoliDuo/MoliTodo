import { useMemo } from "react";
import { useApp } from "./context";
import type { TagColors } from "./components/TaskText";

/** Each tag's own colour, by tag key. */
export function useTagColors(): TagColors {
  const { engine, tick } = useApp();
  return useMemo(() => {
    const colors: TagColors = new Map();
    for (const tag of engine.all("tag")) if (tag.data.color) colors.set(tag.id, tag.data.color);
    return colors;
    // `tick` changes whenever the records do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, tick]);
}
