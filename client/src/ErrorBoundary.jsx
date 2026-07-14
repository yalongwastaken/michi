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
          {/* a sleepy shiba, copied static from the Mascot template's output — inline
              so the boundary never depends on the (possibly crashed) app tree */}
          <svg
            viewBox="0 0 120 150"
            className="mx-auto mb-4 h-16 w-16"
            role="img"
            aria-label="Michi, asleep"
          >
            <ellipse cx="60" cy="140" rx="32" ry="5" fill="#8A8172" opacity="0.18" />
            <circle cx="97" cy="90" r="12" fill="#C96F35" />
            <circle cx="97" cy="90" r="8.3" fill="#E88A4A" />
            <circle cx="97" cy="90" r="4.6" fill="#FFF6E9" />
            <path
              d="M44 16 L30 6 L36 26 C30 30 26 38 26 46 C26 55 30 62 36 66 C32 72 30 80 29 90 C28 100 28 110 30 118 C32 128 36 133 43 136 L45 137 C47 139 51 139 53 137 L67 137 C69 139 73 139 75 137 L77 136 C84 133 88 128 90 118 C92 110 92 100 91 90 C90 80 88 72 84 66 C90 62 94 55 94 46 C94 38 90 30 84 26 L90 6 L76 16 C66 12 54 12 44 16 Z"
              fill="#E88A4A"
            />
            <path
              d="M84 26 C89 31 92 38 92 46 C92 54 89 61 83 65 C87 71 89 80 90 90 C91 100 91 110 89 118 C87 127 83 132 77 135 C82 127 85 117 85 106 C85 95 84 84 81 74 C80 70 78 67 77 65 C82 60 86 54 86 46 C86 39 85 32 84 26 Z"
              fill="#C96F35"
              opacity="0.5"
            />
            <path d="M35 23 L32 12 L41 17.5 Z" fill="#A0552A" />
            <path d="M85 23 L88 12 L79 17.5 Z" fill="#A0552A" />
            <path
              d="M60 70 C52 70 46 75 45 84 C44 102 44 118 46 128 C47 133 49 135.5 53 135.5 C56 135.5 58 134 60 134 C62 134 64 135.5 67 135.5 C71 135.5 73 133 74 128 C76 118 76 102 75 84 C74 75 68 70 60 70 Z"
              fill="#FFF6E9"
            />
            <path
              d="M60 112 C56.8 117 55.5 126 56.5 134 L63.5 134 C64.5 126 63.2 117 60 112 Z"
              fill="#DFC49E"
              opacity="0.9"
            />
            <ellipse cx="45" cy="33" rx="4" ry="3" fill="#FFF6E9" />
            <ellipse cx="75" cy="33" rx="4" ry="3" fill="#FFF6E9" />
            <ellipse cx="60" cy="57" rx="13" ry="10" fill="#FFF6E9" />
            <g stroke="#453833" strokeWidth="2.4" strokeLinecap="round" fill="none">
              <path d="M40.5 45 Q45 48 49.5 45" />
              <path d="M70.5 45 Q75 48 79.5 45" />
            </g>
            <path d="M56 52 h8 l-4 5 Z" fill="#453833" />
            <path
              d="M54 61.5 h12"
              stroke="#453833"
              strokeWidth="2.2"
              strokeLinecap="round"
              fill="none"
            />
            <ellipse cx="33" cy="54" rx="4" ry="2.5" fill="#F4A28C" />
            <ellipse cx="87" cy="54" rx="4" ry="2.5" fill="#F4A28C" />
            <path d="M36 62 Q60 77 84 62 L84 70 Q60 85 36 70 Z" fill="#B95530" />
            <path d="M36 62 Q60 77 84 62 L84 65.5 Q60 80.5 36 65.5 Z" fill="#CB744E" />
            <path d="M41 71 Q60 84 79 71 Q60 88 41 71 Z" fill="#DFC49E" opacity="0.5" />
            <circle cx="60" cy="81" r="4" fill="#E8A13C" />
            <circle cx="60" cy="81" r="4" fill="none" stroke="#C97F1E" strokeWidth="1.2" />
            <path d="M60 81.5 v2.6" stroke="#7F2D03" strokeWidth="1.2" strokeLinecap="round" />
            <g fill="#A09C94" fontWeight="700">
              <text x="86" y="24" fontSize="13">
                z
              </text>
              <text x="95" y="14" fontSize="9">
                z
              </text>
            </g>
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
