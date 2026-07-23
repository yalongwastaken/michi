import { useState } from "react";
import { CalendarRange, Sparkles, Plus, Check } from "lucide-react";
import { Card, Button } from "../ui.jsx";
import { api } from "../lib/api.js";
import { uid } from "../lib/uid.js";
import { todayKey } from "../lib/format.js";
import { weekStartOf, weekdayKeyOf } from "../lib/week.js";

// one area's slice of today: its focus text + a "refine into tasks" affordance
function AreaRow({ ctx, plan, focus, today }) {
  const [suggests, setSuggests] = useState(null); // null = not fetched, [] = none
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(new Set());

  const refine = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      const res = await api.week.refine(focus, plan.area);
      setSuggests(res.tasks || []);
    } catch {
      setSuggests([{ title: focus }]); // still let them add the focus itself
    }
    setBusy(false);
  };

  const add = async (t, i) => {
    const ok = await ctx.addTask({
      id: uid("task"),
      status: "todo",
      title: t.title,
      due: today,
      estMin: t.estMin ?? null,
      goalId: plan.goalId || null, // attribute to the plan's goal when it has one
    });
    if (ok !== false) {
      setAdded((prev) => new Set(prev).add(i));
    }
  };

  return (
    <div className="rounded-lg bg-slate-50 p-2.5 dark:bg-slate-800/50">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-400">
            {plan.area}
          </div>
          <div className="text-sm text-slate-700 dark:text-slate-200">{focus}</div>
        </div>
        <Button
          variant="ghost"
          className="h-8 shrink-0 px-2 text-sm"
          onClick={refine}
          disabled={busy || ctx.busy}
        >
          <Sparkles size={14} /> {busy ? "…" : "Refine"}
        </Button>
      </div>

      {suggests ? (
        suggests.length ? (
          <ul className="mt-2 space-y-1">
            {suggests.map((t, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm text-slate-600 dark:text-slate-300">
                  {t.title}
                  {t.estMin ? (
                    <span className="ml-1 text-xs text-slate-400">~{t.estMin}m</span>
                  ) : null}
                </span>
                <button
                  type="button"
                  onClick={() => add(t, i)}
                  disabled={added.has(i) || ctx.busy}
                  aria-label={`Add task: ${t.title}`}
                  className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-medium text-trail-700 hover:bg-trail-500/10 disabled:opacity-50 dark:text-trail-400"
                >
                  {added.has(i) ? <Check size={14} /> : <Plus size={14} />}
                  {added.has(i) ? "Added" : "Add"}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-slate-400">
            Nothing to suggest — add it as a task above.
          </p>
        )
      ) : null}
    </div>
  );
}

/**
 * The "This week" strip on Today: today's slice of each week-plan area (its day-split
 * focus), with a one-tap "Refine" that breaks a focus into concrete tasks via the
 * local model. Renders nothing when the current week has no focus for today.
 */
export default function ThisWeek({ ctx }) {
  const today = ctx.day || todayKey();
  const weekStart = weekStartOf(today);
  const dayKeyName = weekdayKeyOf(today);

  const rows = (ctx.state?.weekPlans || [])
    .filter((w) => w.weekStart === weekStart)
    .map((w) => ({ plan: w, focus: w.days?.[dayKeyName]?.focus }))
    .filter((r) => r.focus && r.focus.trim());

  if (rows.length === 0) {
    return null;
  }

  return (
    <Card className="p-4">
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-700 dark:text-slate-200">
        <CalendarRange size={15} className="text-trail-600 dark:text-trail-400" />
        This week · today
      </h3>
      <div className="space-y-2">
        {rows.map(({ plan, focus }) => (
          <AreaRow key={plan.id} ctx={ctx} plan={plan} focus={focus} today={today} />
        ))}
      </div>
    </Card>
  );
}
