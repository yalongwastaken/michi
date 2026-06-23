import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

// apply the saved/system theme as early as possible to avoid a flash
function applyTheme(theme) {
  const dark =
    theme === "dark" ||
    (theme !== "light" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", !!dark);
}
applyTheme("system");

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App onTheme={applyTheme} />
  </StrictMode>,
);

// register the service worker for offline/installable PWA (prod build only)
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* offline support is best-effort */
    });
  });
}
