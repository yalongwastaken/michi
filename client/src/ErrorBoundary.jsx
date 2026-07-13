// ErrorBoundary.jsx — catches render crashes so a bug shows a friendly recovery card
// instead of a white screen. A class because React only exposes componentDidCatch on
// classes; zero app imports so the boundary itself has nothing left to crash on.
import { Component } from "react";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // best-effort breadcrumb; fully local app, so the console is the only sink
    console.error("Michi crashed:", error, info?.componentStack);
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }
    const err = this.state.error;
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-2xl bg-white/90 dark:bg-slate-900/80 ring-1 ring-slate-200/70 dark:ring-slate-700/60 shadow-sm p-6 text-center">
          {/* simplified trail mark, inline so we don't depend on the crashed tree */}
          <svg
            viewBox="0 0 512 512"
            className="mx-auto mb-4 h-14 w-14"
            role="img"
            aria-label="Michi"
          >
            <rect width="512" height="512" rx="112" fill="#ECFDF5" />
            <path
              d="M120 420 C 200 380, 150 300, 240 280 C 330 260, 300 180, 384 150"
              fill="none"
              stroke="#10B981"
              strokeWidth="20"
              strokeLinecap="round"
            />
            <circle cx="120" cy="420" r="22" fill="#047857" />
            <circle cx="240" cy="280" r="18" fill="#A78BFA" />
            <circle cx="384" cy="150" r="26" fill="#7C3AED" />
          </svg>
          <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
            Michi tripped on the trail
          </h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Something broke — your data is safe on your mini PC. A reload usually gets things moving
            again.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 inline-flex items-center justify-center rounded-xl bg-trail-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-trail-700 active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-trail-400"
          >
            Reload
          </button>
          <details className="mt-4 text-left">
            <summary className="cursor-pointer text-xs text-slate-500 dark:text-slate-400">
              Error details
            </summary>
            <pre className="mt-2 overflow-x-auto rounded-xl bg-slate-100 dark:bg-slate-800 p-3 text-xs text-slate-600 dark:text-slate-300">
              {String(err?.stack || err)}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}
