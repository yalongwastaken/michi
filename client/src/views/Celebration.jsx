// Celebration.jsx — the toast that lands with the confetti: mascot mid-cheer,
// a headline, one supporting line. Auto-dismisses after 3.5s; the whole card is a
// button so a tap anywhere dismisses it early. aria-live so it's announced politely.
import { useEffect, useRef } from "react";
import Mascot from "./Mascot.jsx";

export default function Celebration({ event, onClose }) {
  // onClose is a fresh identity on every App render — held in a ref so the timer
  // is mount-only and the 3.5s countdown never restarts mid-toast
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const t = setTimeout(() => onCloseRef.current(), 3500);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={`${event.headline} Dismiss.`}
        className="pop pointer-events-auto flex items-center gap-3 rounded-2xl bg-white px-4 py-3 text-left shadow-lg ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700"
      >
        <Mascot mood="celebrate" size={48} />
        <span>
          <span className="block font-semibold text-slate-800 dark:text-slate-100">
            {event.headline}
          </span>
          {event.subline ? (
            <span className="block text-xs text-slate-500 dark:text-slate-400">
              {event.subline}
            </span>
          ) : null}
        </span>
      </button>
    </div>
  );
}
