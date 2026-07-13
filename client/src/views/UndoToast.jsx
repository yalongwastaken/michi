// UndoToast.jsx — the quiet cousin of Celebration: after a delete lands, a small
// bar rests above the tab bar for ~6s offering one tap of regret-insurance.
// No mascot, no confetti — deleting isn't a party. aria-live so it's announced.
import { useEffect, useRef } from "react";
import { Undo2 } from "lucide-react";

export default function UndoToast({ toast, onUndo, onClose }) {
  // onClose is a fresh identity each App render — a ref keeps the 6s timer
  // mount-only so the countdown never restarts mid-toast (same as Celebration)
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const t = setTimeout(() => onCloseRef.current(), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-20 z-40 flex justify-center px-4"
    >
      <div className="pointer-events-auto flex items-center gap-1 rounded-2xl bg-white/95 py-1.5 pl-4 pr-1.5 shadow-lg ring-1 ring-slate-200 backdrop-blur dark:bg-slate-900/95 dark:ring-slate-700">
        <span className="max-w-[15rem] truncate text-sm text-slate-600 dark:text-slate-300">
          Deleted “{toast.title}”
        </span>
        <button
          type="button"
          onClick={onUndo}
          className="inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-sm font-semibold text-trail-600 hover:bg-trail-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-trail-400 dark:text-trail-400 dark:hover:bg-slate-800"
        >
          <Undo2 size={14} /> Undo
        </button>
      </div>
    </div>
  );
}
