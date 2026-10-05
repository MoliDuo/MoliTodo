import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { registerSW } from "virtual:pwa-register";
import { readLocal } from "./hooks";
import { announceUpdate } from "./lib/app-update";
import { applyListSize, LIST_SIZE_KEY, parseListSize } from "./lib/list-size";
import "./styles.css";

// Before the first paint, so the list does not jump from one size to another.
applyListSize(parseListSize(readLocal(LIST_SIZE_KEY)));

// The service worker keeps the app shell on this device; a new version waits until the person reloads. An
// installed app may stay open for days, so it also looks for one every hour.
const UPDATE_CHECK_MS = 60 * 60 * 1000;
const updateSW = registerSW({
  onNeedRefresh: () => announceUpdate(() => void updateSW(true)),
  onRegisteredSW: (_url, registration) =>
    registration && setInterval(() => void registration.update(), UPDATE_CHECK_MS),
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
