import { useState } from "react";
import {
  Check,
  Plus,
  BookOpen,
  CircleDot,
  CheckCircle2,
  Sparkles,
  Clock,
  Repeat,
  Pencil,
  SlidersHorizontal,
  Timer,
  ChevronDown,
  ChevronRight,
  CalendarClock,
  Plus as PlusIcon,
  Lightbulb,
} from "lucide-react";
import { Card, Button, Input, Badge, IconButton } from "../ui.jsx";
import { dueLabel, minutes } from "../lib/format.js";
import { uid } from "../lib/uid.js";
import { parseQuickAdd } from "../lib/quickadd.js";
import TaskModal from "./TaskModal.jsx";

// chips that explain why an item is in today's plan
const REASON = {
  overdue: { label: "overdue", cls: "bg-rose-50 text-rose-600 dark:bg-rose-950/40" },
  due: { label: "due", cls: "bg-rose-50 text-rose-600 dark:bg-rose-950/40" },
  pace: { label: "deadline", cls: "bg-rose-50 text-rose-600 dark:bg-rose-950/40" },
  continue: {
    label: "continue",
    cls: "bg-iris-50 text-iris-600 dark:bg-slate-800 dark:text-iris-300",
  },
  rotate: {
    label: "next up",
    cls: "bg-trail-50 text-trail-700 dark:bg-slate-800 dark:text-trail-300",
  },
  streak: {
    label: "keep streak",
    cls: "bg-iris-50 text-iris-600 dark:bg-slate-800 dark:text-iris-300",
  },
};

function greeting() {
  const h = new Date().getHours();
  if (h < 5) {
    return "Still up";
  }
  if (h < 12) {
    return "Good morning";
  }
  if (h < 18) {
    return "Good afternoon";
  }
  return "Good evening";
}

function Row({ item, onToggle, busy, onEdit, onSkip, showReason }) {
  const isStep = item.kind === "step";
  const done = item.status === "done";
  const reason = showReason
    ? REASON[
        item.reason === "pace"
          ? "pace"
          : item.reason === "continue" || item.status === "doing"
            ? "continue"
            : item.reason
      ]
    : null;
  return (
    <div className="group flex items-start gap-3 px-4 py-3">
      <button
        disabled={busy}
        onClick={() => onToggle(item.kind, item.id, !done)}
        aria-label={done ? "Mark not done" : "Mark done"}
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition ${
          done
            ? "border-trail-500 bg-trail-500 text-white pop"
            : "border-slate-300 text-transparent hover:border-trail-400 dark:border-slate-600"
        }`}
      >
        <Check size={14} strokeWidth={3} />
      </button>
      <div className="min-w-0 flex-1">
        <p
          className={`text-sm font-medium ${
            done ? "text-slate-400 line-through" : "text-slate-800 dark:text-slate-100"
          }`}
        >
          {item.title}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
          {isStep ? (
            <span className="inline-flex items-center gap-1">
              <BookOpen size={12} />
              {item.roadmapTitle}
              {item.milestoneTitle ? ` · ${item.milestoneTitle}` : ""}
            </span>
          ) : null}
          {item.resourceUrl ? (
            <a
              href={item.resourceUrl}
              target="_blank"
              rel="noreferrer"
              className="text-trail-600 hover:underline"
            >
              open resource
            </a>
          ) : null}
          {item.due ? (
            <Badge className="bg-slate-100 text-slate-500 dark:bg-slate-800">
              {dueLabel(item.due)}
            </Badge>
          ) : null}
          {item.recurrence ? (
            <Badge className="bg-trail-50 text-trail-600 dark:bg-slate-800">
              <Repeat size={11} /> {item.recurrence}
            </Badge>
          ) : null}
          {minutes(item.estMin) ? (
            <span className="inline-flex items-center gap-1">
              <Clock size={11} /> {minutes(item.estMin)}
            </span>
          ) : null}
          {reason ? <Badge className={reason.cls}>{reason.label}</Badge> : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center">
        {onSkip ? (
          <IconButton label="Not today" className="h-9 w-9" onClick={() => onSkip(item)}>
            <CalendarClock size={15} />
          </IconButton>
        ) : null}
        {onEdit && !isStep ? (
          <IconButton label="Edit task" className="h-9 w-9" onClick={() => onEdit(item)}>
            <Pencil size={15} />
          </IconButton>
        ) : null}
      </div>
    </div>
  );
}

function Section({ title, icon: Icon, items, onToggle, busy, onEdit, tint = "text-slate-400" }) {
  if (!items?.length) {
    return null;
  }
  return (
    <div>
      <div
        className={`mb-1.5 flex items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wide ${tint}`}
      >
        <Icon size={13} /> {title} <span className="text-slate-300">· {items.length}</span>
      </div>
      <Card className="divide-y divide-slate-100 dark:divide-slate-800">
        {items.map((it) => (
          <Row
            key={`${it.kind}_${it.id}`}
            item={it}
            onToggle={onToggle}
            busy={busy}
            onEdit={onEdit}
          />
        ))}
      </Card>
    </div>
  );
}

const BUDGETS = [30, 60, 90, 120];

function PlanCard({ ctx, onEdit }) {
  const { plan, complete, save, replan, skipPlanItem, aiEnabled, busy } = ctx;
  const [thinking, setThinking] = useState(false);
  if (!plan) {
    return null;
  }
  const budget = ctx.state.settings?.dailyMinutes ?? 60;
  const setBudget = (n) => save((s) => (s.settings.dailyMinutes = n));
  const smarter = async () => {
    setThinking(true);
    await replan({ ai: true });
    setThinking(false);
  };
  const oneMore = () => replan({ budget: (plan.plannedMin || budget) + 30 });

  return (
    <Card className="overflow-hidden">
      <div className="trail-gradient flex items-center justify-between gap-2 px-4 py-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-100">
            <Sparkles size={16} className="text-iris-500" /> Your day
            {plan.source === "ai" ? (
              <Badge className="bg-iris-500/15 text-iris-600 dark:text-iris-300">AI</Badge>
            ) : null}
          </h3>
          <p className="mt-0.5 truncate text-xs text-slate-500">{plan.why}</p>
        </div>
        {aiEnabled ? (
          <Button
            variant="subtle"
            disabled={busy || thinking}
            onClick={smarter}
            className="shrink-0 !py-1.5 text-xs"
          >
            <Sparkles size={14} /> {thinking ? "Thinking…" : "Smarter plan"}
          </Button>
        ) : null}
      </div>

      {plan.items.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-slate-400">
          Nothing to plan yet — add a task or line up some roadmap steps.
        </p>
      ) : (
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {plan.items.map((it) => (
            <Row
              key={`${it.kind}_${it.id}`}
              item={it}
              onToggle={complete}
              busy={busy}
              onEdit={onEdit}
              onSkip={(x) => skipPlanItem(x.kind, x.id, true)}
              showReason
            />
          ))}
          <button
            onClick={oneMore}
            disabled={busy}
            className="flex w-full items-center justify-center gap-1.5 py-2.5 text-xs font-medium text-slate-400 hover:text-trail-600"
          >
            <PlusIcon size={14} /> one more
          </button>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-4 py-2.5 dark:border-slate-800">
        <span className="inline-flex items-center gap-1 text-xs text-slate-400">
          <Timer size={13} /> ~{plan.plannedMin} min
          {plan.overflow ? <span className="text-rose-500"> (over budget)</span> : null}
        </span>
        <div className="flex items-center gap-1">
          {BUDGETS.map((n) => (
            <button
              key={n}
              disabled={busy}
              onClick={() => setBudget(n)}
              className={`rounded-lg px-2 py-1 text-xs font-medium transition ${
                budget === n
                  ? "bg-trail-600 text-white"
                  : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              }`}
            >
              {n >= 60 ? `${n / 60}h` : `${n}m`}
            </button>
          ))}
        </div>
      </div>
    </Card>
  );
}

function Nudges({ items }) {
  if (!items?.length) {
    return null;
  }
  const tone = {
    warn: "text-rose-600",
    good: "text-trail-600",
    info: "text-iris-600",
  };
  return (
    <div className="space-y-1.5">
      {items.map((n, i) => (
        <div
          key={i}
          className="flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/60"
        >
          <Lightbulb size={15} className={`mt-0.5 shrink-0 ${tone[n.tone] || "text-slate-400"}`} />
          <span className="text-slate-600 dark:text-slate-300">{n.text}</span>
        </div>
      ))}
    </div>
  );
}

export default function Today({ ctx }) {
  const { today, momentum, complete, addTask, busy, state } = ctx;
  const [text, setText] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [showBrowse, setShowBrowse] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [editTask, setEditTask] = useState(null);

  // open the editor with the full stored task (the queue item is a lean projection)
  const openEdit = (item) => {
    const full = (state.tasks || []).find((t) => t.id === item.id);
    setEditTask(full || item);
  };

  if (!today) {
    return null;
  }

  const submit = async (e) => {
    e.preventDefault();
    if (!text.trim()) {
      return;
    }
    // parse natural language: "read SPI 30m tomorrow" → title + due + estimate + repeat
    const p = parseQuickAdd(text, { today: today.day });
    const title = p.title || text.trim();
    setText("");
    await addTask({
      id: uid("task"),
      status: "todo",
      title,
      due: p.due || (p.recurrence ? null : today.day),
      estMin: p.estMin ?? null,
      recurrence: p.recurrence ?? null,
    });
  };

  const goal = momentum?.dailyGoal ?? 3;
  const did = momentum?.todayCount ?? 0;
  const browseCount = today.overdue.length + today.dueToday.length + today.suggested.length;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
          {greeting()}
          {ctx.state.profile?.name ? `, ${ctx.state.profile.name}` : ""}.
        </h2>
        <p className="text-sm text-slate-500">
          {did >= goal ? (
            <span className="text-trail-600">Goal met — {did} done today. Keep rolling.</span>
          ) : (
            <>
              You&apos;ve done {did} of {goal} today. Here&apos;s a doable plan.
            </>
          )}
        </p>
        <div className="mt-2 flex gap-1.5">
          {Array.from({ length: goal }).map((_, i) => (
            <span
              key={i}
              className={`h-1.5 flex-1 rounded-full ${
                i < did ? "bg-trail-500" : "bg-slate-200 dark:bg-slate-700"
              }`}
            />
          ))}
        </div>
      </div>

      <Nudges items={ctx.nudges} />

      <form onSubmit={submit} className="flex gap-2">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a task… e.g. “read SPI 30m tomorrow”"
          aria-label="New task"
        />
        <IconButton
          label="Add with details"
          type="button"
          onClick={() => setShowNew(true)}
          className="shrink-0 border border-slate-300 dark:border-slate-600"
        >
          <SlidersHorizontal size={16} />
        </IconButton>
        <Button type="submit" disabled={busy || !text.trim()} aria-label="Add task">
          <Plus size={16} />
        </Button>
      </form>

      <PlanCard ctx={ctx} onEdit={openEdit} />

      {browseCount > 0 ? (
        <div>
          <button
            onClick={() => setShowBrowse((v) => !v)}
            className="flex items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-slate-400"
          >
            {showBrowse ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Browse everything
            · {browseCount}
          </button>
          {showBrowse ? (
            <div className="mt-2 space-y-4">
              <Section
                title="Overdue"
                icon={CircleDot}
                items={today.overdue}
                onToggle={complete}
                busy={busy}
                onEdit={openEdit}
                tint="text-rose-500"
              />
              <Section
                title="Due today"
                icon={CircleDot}
                items={today.dueToday}
                onToggle={complete}
                busy={busy}
                onEdit={openEdit}
              />
              <Section
                title="Suggested next steps"
                icon={Sparkles}
                items={today.suggested}
                onToggle={complete}
                busy={busy}
                tint="text-trail-600"
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {today.doneToday?.length ? (
        <div>
          <button
            onClick={() => setShowDone((v) => !v)}
            className="flex items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-slate-400"
          >
            <CheckCircle2 size={13} /> Done today · {today.doneToday.length}
            <span className="text-slate-300">{showDone ? "▾" : "▸"}</span>
          </button>
          {showDone ? (
            <Card className="mt-1.5 divide-y divide-slate-100 dark:divide-slate-800">
              {today.doneToday.map((it) => (
                <Row key={`${it.kind}_${it.id}`} item={it} onToggle={complete} busy={busy} />
              ))}
            </Card>
          ) : null}
        </div>
      ) : null}

      {showNew ? <TaskModal ctx={ctx} onClose={() => setShowNew(false)} /> : null}
      {editTask ? <TaskModal ctx={ctx} task={editTask} onClose={() => setEditTask(null)} /> : null}
    </div>
  );
}
