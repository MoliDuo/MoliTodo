import { useSyncExternalStore } from "react";

// Hash routes, so the server keeps serving one page and reloads land where the person was.

export type Route =
  | { name: "today"; day: string | null }
  | { name: "index"; query: string }
  | { name: "tag"; tag: string }
  | { name: "book"; year: number | null; day: string | null }
  | { name: "timer" }
  | { name: "stats" }
  | { name: "me" };

export function parseRoute(hash: string): Route {
  const [path = "", search = ""] = hash.replace(/^#\/?/, "").split("?");
  const parts = path.split("/").map((part) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return part;
    }
  });
  const params = new URLSearchParams(search);
  const day = (value: string | undefined) =>
    value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  switch (parts[0]) {
    case "day":
      return { name: "today", day: day(parts[1]) };
    case "index":
      return { name: "index", query: params.get("q") ?? "" };
    case "tag":
      return parts[1] ? { name: "tag", tag: parts[1] } : { name: "index", query: "" };
    case "book": {
      const year = Number(parts[1]);
      return {
        name: "book",
        year: Number.isInteger(year) && year > 1900 ? year : null,
        day: day(params.get("day") ?? undefined),
      };
    }
    case "timer":
      return parts[1] === "stats" ? { name: "stats" } : { name: "timer" };
    case "me":
      return { name: "me" };
    default:
      return { name: "today", day: null };
  }
}

export function routeHash(route: Route): string {
  switch (route.name) {
    case "today":
      return route.day ? `#/day/${route.day}` : "#/";
    case "index":
      return route.query ? `#/index?q=${encodeURIComponent(route.query)}` : "#/index";
    case "tag":
      return `#/tag/${encodeURIComponent(route.tag)}`;
    case "book": {
      const base = route.year ? `#/book/${route.year}` : "#/book";
      return route.day ? `${base}?day=${route.day}` : base;
    }
    case "timer":
      return "#/timer";
    case "stats":
      return "#/timer/stats";
    case "me":
      return "#/me";
  }
}

export function navigate(route: Route, replace = false): void {
  const hash = routeHash(route);
  if (window.location.hash === hash) return;
  if (replace) window.history.replaceState(null, "", hash);
  else window.history.pushState(null, "", hash);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

const subscribe = (listener: () => void) => {
  window.addEventListener("hashchange", listener);
  window.addEventListener("popstate", listener);
  return () => {
    window.removeEventListener("hashchange", listener);
    window.removeEventListener("popstate", listener);
  };
};

export const useHash = (): string => useSyncExternalStore(subscribe, () => window.location.hash);
