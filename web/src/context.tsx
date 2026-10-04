import { createContext, useContext } from "react";
import type { MeResponse } from "@shared/api";
import type { SyncEngine } from "./lib/sync";

export interface AppContextValue {
  engine: SyncEngine;
  me: MeResponse;
  /** Now, refreshed every few seconds so "today" turns over at midnight. */
  now: number;
  today: string;
  /** Changes whenever the records do; part of memo keys. */
  tick: number;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp outside AppContext");
  return value;
}
