// ui.jsx — small shared presentational primitives, so the views stay readable.
import { useEffect, useRef } from "react";
import { X } from "lucide-react";

export function Card({ className = "", children, ...rest }) {
  return (
    <div
      className={`rounded-2xl bg-white/90 dark:bg-slate-900/80 ring-1 ring-slate-200/70 dark:ring-slate-700/60 shadow-sm ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

const VARIANTS = {
  primary:
    "bg-trail-600 hover:bg-trail-700 text-white shadow-sm disabled:opacity-50 disabled:cursor-not-allowed",
  ghost:
    "bg-transparent hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200",
  subtle:
    "bg-trail-50 hover:bg-trail-100 text-trail-700 dark:bg-slate-800 dark:text-trail-300 dark:hover:bg-slate-700",
  danger: "bg-rose-600 hover:bg-rose-700 text-white",
};

export function Button({ variant = "primary", className = "", children, ...rest }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium transition active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-trail-400 ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function IconButton({ label, className = "", children, ...rest }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={`inline-flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 transition ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Badge({ children, className = "" }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${className}`}
    >
      {children}
    </span>
  );
}

export function ProgressBar({ pct = 0, color }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
      <div
        className="h-full rounded-full bg-trail-500 transition-[width] duration-500"
        style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color || undefined }}
      />
    </div>
  );
}

export function Field({ label, children, hint }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-600 dark:text-slate-300">
        {label}
      </span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-slate-400">{hint}</span> : null}
    </label>
  );
}

const INPUT =
  "w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:border-trail-400 focus:outline-none focus:ring-2 focus:ring-trail-200 dark:focus:ring-trail-800";

export function Input(props) {
  return <input className={INPUT} {...props} />;
}
export function Select({ children, ...props }) {
  return (
    <select className={INPUT} {...props}>
      {children}
    </select>
  );
}
export function Textarea(props) {
  return <textarea className={INPUT} rows={3} {...props} />;
}

export function Modal({ title, onClose, children, footer }) {
  const ref = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        onClose?.();
        return;
      }
      if (e.key !== "Tab") {
        return;
      }
      // trap focus inside the dialog
      const f = ref.current?.querySelectorAll(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!f || !f.length) {
        return;
      }
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    const prev = document.activeElement; // restore focus to the trigger on close
    document.addEventListener("keydown", onKey);
    ref.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/40 p-0 sm:p-4 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}
    >
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full sm:max-w-md max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-white dark:bg-slate-900 p-5 shadow-xl ring-1 ring-slate-200 dark:ring-slate-700 focus:outline-none"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">{title}</h2>
          <IconButton label="Close" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
        <div className="space-y-4">{children}</div>
        {footer ? <div className="mt-5 flex justify-end gap-2">{footer}</div> : null}
      </div>
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children, action }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 px-6 py-12 text-center">
      {Icon ? (
        <div className="rounded-2xl bg-trail-50 dark:bg-slate-800 p-3 text-trail-600 dark:text-trail-300">
          <Icon size={26} />
        </div>
      ) : null}
      <h3 className="text-base font-semibold text-slate-700 dark:text-slate-200">{title}</h3>
      {children ? <p className="max-w-xs text-sm text-slate-500">{children}</p> : null}
      {action}
    </div>
  );
}
