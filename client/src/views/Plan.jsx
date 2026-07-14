import { useState } from "react";
import { Map as MapIcon, Hammer } from "lucide-react";
import Roadmaps from "./Roadmaps.jsx";
import Projects from "./Projects.jsx";

// Plan folds the two "what am I building toward" views — roadmaps (learning paths)
// and projects (things to ship) — behind one tab. A segmented control swaps between
// them; each sub-view keeps its own header + New/Import actions untouched.
const SUBS = [
  { id: "roadmaps", label: "Roadmaps", icon: MapIcon },
  { id: "projects", label: "Projects", icon: Hammer },
];

export default function Plan({ ctx }) {
  const [sub, setSub] = useState("roadmaps");
  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label="Plan view"
        className="flex gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800/70"
      >
        {SUBS.map(({ id, label, icon: Icon }) => {
          const active = sub === id;
          return (
            <button
              key={id}
              role="tab"
              aria-selected={active}
              onClick={() => setSub(id)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                active
                  ? "bg-white text-trail-700 shadow-sm dark:bg-slate-900 dark:text-trail-400"
                  : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
            >
              <Icon size={15} /> {label}
            </button>
          );
        })}
      </div>

      {sub === "roadmaps" ? <Roadmaps ctx={ctx} /> : <Projects ctx={ctx} />}
    </div>
  );
}
