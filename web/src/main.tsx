import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { readLocal } from "./hooks";
import { applyListSize, LIST_SIZE_KEY, parseListSize } from "./lib/list-size";
import "./styles.css";

// Before the first paint, so the list does not jump from one size to another.
applyListSize(parseListSize(readLocal(LIST_SIZE_KEY)));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
