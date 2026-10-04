/** The two files the app keeps in its data folder (the Rust side only accepts these names). */
export type DataFile = "state.json" | "settings.json";

/** What the page needs from the machine, so the app logic can be tested without a window. */
export interface Platform {
  readFile(name: DataFile): Promise<string | null>;
  writeFile(name: DataFile, text: string): Promise<void>;
  /** Moves an unreadable file aside so it is kept for recovery instead of overwritten. */
  quarantineFile(name: DataFile): Promise<void>;
  /** The old 哞哞清单 task file where it used to be (Windows), or null. */
  readLegacyStore(): Promise<string | null>;
  /** `fetch` without the browser's cross-site limits: used for the sign-in service and our server. */
  fetch: typeof fetch;
  /** Opens a page in the system browser. */
  openUrl(url: string): Promise<void>;
}

/** Window, tray and start-up behaviour. */
export interface WindowControl {
  setPermanentTop(on: boolean): Promise<void>;
  setCollapsed(collapsed: boolean, expandedHeight: number): Promise<void>;
  isAutostart(): Promise<boolean>;
  setAutostart(on: boolean): Promise<void>;
  hide(): Promise<void>;
  quit(): Promise<void>;
  /** The tray menu changed a setting; the page follows. Returns a function that stops listening. */
  onTrayChange(
    listener: (change: { permanentTop?: boolean; autostart?: boolean }) => void
  ): () => void;
  /** The tray menu's 「检查更新…」 was chosen (the window is already shown). */
  onCheckUpdates(listener: () => void): () => void;
}
