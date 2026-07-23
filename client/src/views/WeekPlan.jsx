import { useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Pencil,
  Copy,
  CalendarRange,
  Sparkles,
  X,
} from "lucide-react";
import {
  Card,
  Button,
  IconButton,
  Badge,
  Field,
  Input,
  Select,
  Modal,
  ConfirmButton,
  EmptyState,
} from "../ui.jsx";
import { uid } from "../lib/uid.js";
import { todayKey, addDays } from "../lib/format.js";
import { weekStartOf, weekdayKeyOf, weekDays, weekLabel, WEEKDAYS } from "../lib/week.js";
import PlanWeekWithClaude from "./PlanWeekWithClaude.jsx";

// one area's plan for the week: theme, a day-split grid, and a targets checklist
function PlanCard({ ctx, plan, weekStart, today }) {
  const { save, busy } = ctx;
  const [editing, setEditing] = useState(false);
  const [newTarget, setNewTarget] = useState("");
  const todayKeyName = weekdayKeyOf(today);
  const inThisWeek = weekStartOf(today) === weekStart;

  const patch = (fn) =>
    save((s) => {
      const w = (s.weekPlans || []).find((x) => x.id === plan.id);
      if (w) {
        fn(w);
      }
    });

  const toggleTarget = (i) =>
    patch((w) => {
      if (w.targets?.[i]) {
        w.targets[i].done = !w.targets[i].done;
      }
    });
  const addTarget = async () => {
    const text = newTarget.trim();
    if (!text) {
      return;
    }
    await patch((w) => {
      w.targets = w.targets || [];
      w.targets.push({ text, done: false });
    });
    setNewTarget("");
  };

  const goal = (ctx.state.goals || []).find((g) => g.id === plan.goalId);

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="truncate font-semibold text-slate-800 dark:text-slate-100">{plan.area}</h4>
          {plan.theme ? <p className="mt-0.5 text-sm text-slate-500">{plan.theme}</p> : null}
          {goal ? (
            <Badge className="mt-1 bg-trail-500/15 text-trail-700 dark:text-trail-300">
              → {goal.title}
            </Badge>
          ) : null}
        </div>
        <IconButton
          label={`Edit ${plan.area} plan`}
          onClick={() => setEditing(true)}
          disabled={busy}
        >
          <Pencil size={15} />
        </IconButton>
      </div>

      {/* day-split: Mon→Sun, today's column tinted when viewing the current week */}
      <div className="mt-3 grid grid-cols-7 gap-1">
        {weekDays(weekStart).map((d) => {
          const focus = plan.days?.[d.key]?.focus;
          const isToday = inThisWeek && d.key === todayKeyName;
          return (
            <div
              key={d.key}
              className={`rounded-lg p-1.5 text-center ${
                isToday
                  ? "bg-trail-500/10 ring-1 ring-trail-500/40"
                  : "bg-slate-50 dark:bg-slate-800/50"
              }`}
            >
              <div className="text-[10px] font-medium uppercase text-slate-400">{d.label}</div>
              <div className="mt-0.5 min-h-[1.5rem] text-[11px] leading-tight text-slate-600 dark:text-slate-300">
                {focus || <span className="text-slate-300 dark:text-slate-600">·</span>}
              </div>
            </div>
          );
        })}
      </div>

      {/* weekly targets checklist */}
      <div className="mt-3">
        <ul className="space-y-0.5">
          {(plan.targets || []).map((t, i) => (
            <li key={i}>
              <label className="flex cursor-pointer items-center gap-2 rounded-lg px-1 py-1 hover:bg-slate-100 dark:hover:bg-slate-800">
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0 accent-trail-600"
                  checked={!!t.done}
                  onChange={() => toggleTarget(i)}
                />
                <span
                  className={`min-w-0 flex-1 truncate text-sm ${
                    t.done ? "text-slate-400 line-through" : "text-slate-700 dark:text-slate-200"
                  }`}
                >
                  {t.text}
                </span>
              </label>
            </li>
          ))}
        </ul>
        <div className="mt-1.5 flex gap-2">
          <Input
            value={newTarget}
            onChange={(e) => setNewTarget(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addTarget()}
            placeholder="Add a weekly target…"
            aria-label={`Add a target to ${plan.area}`}
            className="h-8 text-sm"
          />
          <Button
            variant="ghost"
            className="h-8 shrink-0 px-2"
            onClick={addTarget}
            disabled={busy || !newTarget.trim()}
          >
            <Plus size={15} />
          </Button>
        </div>
      </div>

      {editing ? <PlanModal ctx={ctx} plan={plan} onClose={() => setEditing(false)} /> : null}
    </Card>
  );
}

// add / edit a week plan: area, theme, goal link, the 7-day split, and targets
function PlanModal({ ctx, plan = null, weekStart, onClose }) {
  const editing = !!plan;
  const { state, save, busy } = ctx;
  const [area, setArea] = useState(plan?.area || "");
  const [theme, setTheme] = useState(plan?.theme || "");
  const [goalId, setGoalId] = useState(plan?.goalId || "");
  const [days, setDays] = useState(() => {
    const d = {};
    for (const w of WEEKDAYS) {
      d[w.key] = plan?.days?.[w.key]?.focus || "";
    }
    return d;
  });
  const [targets, setTargets] = useState(() =>
    (plan?.targets || []).map((t) => ({ text: t.text, done: !!t.done })),
  );
  const [newTarget, setNewTarget] = useState("");

  const goals = (state.goals || []).filter((g) => g.status !== "achieved");

  const buildDays = () => {
    const out = {};
    for (const w of WEEKDAYS) {
      const focus = (days[w.key] || "").trim();
      if (focus) {
        out[w.key] = { focus };
      }
    }
    return out;
  };

  const addTarget = () => {
    const text = newTarget.trim();
    if (!text) {
      return;
    }
    setTargets((prev) => [...prev, { text, done: false }]);
    setNewTarget("");
  };

  const submit = async () => {
    if (!area.trim()) {
      return;
    }
    const ok = await save((s) => {
      s.weekPlans = s.weekPlans || [];
      if (editing) {
        const w = s.weekPlans.find((x) => x.id === plan.id);
        if (w) {
          w.area = area.trim();
          w.theme = theme.trim() || null;
          w.goalId = goalId || null;
          w.days = buildDays();
          w.targets = targets;
        }
      } else {
        s.weekPlans.push({
          id: uid("wk"),
          weekStart,
          area: area.trim(),
          theme: theme.trim() || null,
          goalId: goalId || null,
          days: buildDays(),
          targets,
          position: s.weekPlans.filter((x) => x.weekStart === weekStart).length,
          createdAt: new Date().toISOString(),
        });
      }
    });
    if (ok !== false) {
      onClose();
    }
  };

  return (
    <Modal
      title={editing ? `Edit ${plan.area}` : "New week plan"}
      onClose={onClose}
      footer={
        <>
          {editing ? (
            <ConfirmButton
              label="Delete week plan"
              confirm="Delete this plan?"
              onConfirm={async () => {
                const ok = await save((s) => {
                  s.weekPlans = (s.weekPlans || []).filter((x) => x.id !== plan.id);
                });
                if (ok !== false) {
                  onClose();
                }
              }}
              disabled={busy}
              className="mr-auto h-9 px-2"
            >
              Delete
            </ConfirmButton>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !area.trim()}>
            {editing ? "Save" : "Add"}
          </Button>
        </>
      }
    >
      <Field label="Area">
        <Input
          autoFocus
          value={area}
          onChange={(e) => setArea(e.target.value)}
          placeholder="e.g. Japanese · Climbing"
        />
      </Field>
      <Field label="Theme" hint="One line of intent for the week.">
        <Input
          value={theme}
          onChange={(e) => setTheme(e.target.value)}
          placeholder="e.g. consolidate chapter 3"
        />
      </Field>
      {goals.length ? (
        <Field label="Toward a goal">
          <Select value={goalId} onChange={(e) => setGoalId(e.target.value)}>
            <option value="">None</option>
            {goals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}

      <Field label="Day split" hint="What each day is for — leave blank for a rest day.">
        <div className="space-y-1.5">
          {WEEKDAYS.map((w) => (
            <div key={w.key} className="flex items-center gap-2">
              <span className="w-9 shrink-0 text-xs font-medium uppercase text-slate-400">
                {w.label}
              </span>
              <Input
                value={days[w.key]}
                onChange={(e) => setDays((prev) => ({ ...prev, [w.key]: e.target.value }))}
                placeholder="—"
                aria-label={`${w.label} focus`}
                className="h-8 text-sm"
              />
            </div>
          ))}
        </div>
      </Field>

      <Field label="Weekly targets">
        <ul className="mb-1.5 space-y-1">
          {targets.map((t, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm text-slate-700 dark:text-slate-200">
                {t.text}
              </span>
              <IconButton
                label={`Remove target ${t.text}`}
                className="h-7 w-7"
                onClick={() => setTargets((prev) => prev.filter((_, j) => j !== i))}
              >
                <X size={14} />
              </IconButton>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <Input
            value={newTarget}
            onChange={(e) => setNewTarget(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addTarget())}
            placeholder="Add a target…"
            aria-label="New target"
            className="h-8 text-sm"
          />
          <Button
            variant="ghost"
            className="h-8 shrink-0 px-2"
            onClick={addTarget}
            disabled={!newTarget.trim()}
          >
            <Plus size={15} />
          </Button>
        </div>
      </Field>
    </Modal>
  );
}

/**
 * The Week view (Plan tab): the overarching weekly layer above the daily plan.
 * One card per focus area — weekly targets + a per-day split — browsable week to
 * week, with a one-tap "copy last week" so a repeating rhythm carries forward.
 */
export default function WeekPlan({ ctx }) {
  const today = ctx.day || todayKey();
  const [weekStart, setWeekStart] = useState(weekStartOf(today));
  const [adding, setAdding] = useState(false);
  const [planning, setPlanning] = useState(false); // the Claude round-trip panel

  const all = ctx.state?.weekPlans || [];
  const plans = all
    .filter((w) => w.weekStart === weekStart)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const lastWeek = weekStartOf(addDays(weekStart, -7));
  const lastWeekPlans = all.filter((w) => w.weekStart === lastWeek);

  const copyLastWeek = () =>
    ctx.save((s) => {
      s.weekPlans = s.weekPlans || [];
      for (const w of s.weekPlans.filter((x) => x.weekStart === lastWeek)) {
        s.weekPlans.push({
          ...structuredClone(w),
          id: uid("wk"),
          weekStart,
          // a fresh week starts with its targets unchecked
          targets: (w.targets || []).map((t) => ({ text: t.text, done: false })),
          createdAt: new Date().toISOString(),
        });
      }
    });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <IconButton label="Previous week" onClick={() => setWeekStart(addDays(weekStart, -7))}>
            <ChevronLeft size={18} />
          </IconButton>
          <div className="min-w-[8.5rem] text-center">
            <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              {weekLabel(weekStart)}
            </div>
            {weekStart === weekStartOf(today) ? (
              <div className="text-[11px] text-trail-600 dark:text-trail-400">this week</div>
            ) : null}
          </div>
          <IconButton label="Next week" onClick={() => setWeekStart(addDays(weekStart, 7))}>
            <ChevronRight size={18} />
          </IconButton>
        </div>
        <IconButton label="New week plan" onClick={() => setAdding(true)} disabled={ctx.busy}>
          <Plus size={18} />
        </IconButton>
      </div>

      <Card className="p-3">
        <button
          type="button"
          onClick={() => setPlanning((v) => !v)}
          aria-expanded={planning}
          className="flex w-full items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200"
        >
          <Sparkles size={15} className="text-iris-500" />
          Plan this week with Claude
          <ChevronRight
            size={16}
            className={`ml-auto text-slate-400 transition-transform ${planning ? "rotate-90" : ""}`}
          />
        </button>
        {planning ? (
          <div className="mt-3">
            <PlanWeekWithClaude ctx={ctx} weekStart={weekStart} />
          </div>
        ) : null}
      </Card>

      {plans.length === 0 ? (
        <EmptyState
          icon={CalendarRange}
          title="No plan for this week yet"
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="ghost" onClick={() => setAdding(true)}>
                <Plus size={15} /> New week plan
              </Button>
              {lastWeekPlans.length ? (
                <Button variant="ghost" onClick={copyLastWeek} disabled={ctx.busy}>
                  <Copy size={15} /> Copy last week
                </Button>
              ) : null}
            </div>
          }
        >
          Sketch an area like “Japanese” with weekly targets and a day-by-day split — Claude can
          draft it for you, or start one by hand.
        </EmptyState>
      ) : (
        <>
          <div className="space-y-3">
            {plans.map((w) => (
              <PlanCard key={w.id} ctx={ctx} plan={w} weekStart={weekStart} today={today} />
            ))}
          </div>
          {lastWeekPlans.length ? (
            <Button variant="ghost" className="w-full" onClick={copyLastWeek} disabled={ctx.busy}>
              <Copy size={15} /> Copy last week’s plan into this week
            </Button>
          ) : null}
        </>
      )}

      {adding ? (
        <PlanModal ctx={ctx} weekStart={weekStart} onClose={() => setAdding(false)} />
      ) : null}
    </div>
  );
}
