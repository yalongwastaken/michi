import { useEffect, useState } from "react";
import { Sparkles, ChevronDown, ChevronRight } from "lucide-react";
import { Card } from "../ui.jsx";
import PlanWithClaude from "./PlanWithClaude.jsx";

// The collapsible "Plan with Claude" card — the export/sync round-trip surfaced on
// a tab instead of buried in Settings. Deliberately one component so the gesture is
// identical everywhere it appears (Today, Roadmaps, Projects): copy the prompt,
// paste the reply, review the diff, apply. `title`/`blurb` reframe it per tab;
// `defaultOpen` + `onOpen` let Today keep its once-a-day auto-expand.
export default function PlanWithClaudeCard({
  ctx,
  title = "Plan with Claude",
  blurb,
  defaultOpen = false,
  onOpen,
}) {
  const [open, setOpen] = useState(defaultOpen);
  // an auto-open (defaultOpen) still counts as opened — fire onOpen once on mount
  useEffect(() => {
    if (defaultOpen) {
      onOpen?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Card className="overflow-hidden">
      <button
        onClick={() => {
          onOpen?.();
          setOpen((v) => !v);
        }}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-100">
          <Sparkles size={16} className="text-iris-500 dark:text-iris-300" /> {title}
        </span>
        {open ? (
          <ChevronDown size={16} className="text-slate-400" />
        ) : (
          <ChevronRight size={16} className="text-slate-400" />
        )}
      </button>
      {open ? (
        <div className="border-t border-slate-100 px-4 py-3 dark:border-slate-800">
          {blurb ? <p className="mb-3 text-xs text-slate-400">{blurb}</p> : null}
          <PlanWithClaude ctx={ctx} />
        </div>
      ) : null}
    </Card>
  );
}
