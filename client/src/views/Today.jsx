import { useEffect, useRef, useState } from "react";
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
  Footprints,
  ListTodo,
  StickyNote,
} from "lucide-react";
import { Card, Button, Input, Badge, IconButton } from "../ui.jsx";
import { dueLabel, minutes } from "../lib/format.js";
import { uid } from "../lib/uid.js";
import { parseQuickAdd } from "../lib/quickadd.js";
import TaskModal from "./TaskModal.jsx";
import Backlog from "./Backlog.jsx";
import Mascot from "./Mascot.jsx";
import CoachBubble from "./CoachBubble.jsx";

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

// donut of the daily goal — persimmon while walking, indigo (with a pop) once met.
// Decorative: the coach line right beside it says the same thing in words.
function ProgressRing({ done, goal }) {
  const met = goal > 0 && done >= goal;
  const pct = Math.min(1, goal ? done / goal : 0);
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <svg
      viewBox="0 0 64 64"
      className={`h-16 w-16 shrink-0 ${met ? "pop" : ""}`}
      aria-hidden="true"
    >
      <circle
        cx="32"
        cy="32"
        r={r}
        fill="none"
        strokeWidth="6"
        className="stroke-slate-200 dark:stroke-slate-700"
      />
      <circle
        cx="32"
        cy="32"
        r={r}
        fill="none"
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={`${c * pct} ${c}`}
        transform="rotate(-90 32 32)"
        className={`transition-[stroke-dasharray] duration-500 ${
          met ? "stroke-iris-500" : "stroke-trail-500"
        }`}
      />
      <text
        x="32"
        y="37"
        textAnchor="middle"
        fontSize="14"
        fontWeight="700"
        className={met ? "fill-iris-600 dark:fill-iris-300" : "fill-slate-700 dark:fill-slate-100"}
      >
        {done}/{goal}
      </text>
    </svg>
  );
}

// compact footprints-on-the-trail streak chip — same palette as Momentum's streak
// card: iris while alive, amber when today would break it, grey before day one
function StreakChip({ streak }) {
  if (!streak) {
    return null;
  }
  const n = streak.current;
  const cls =
    n === 0
      ? "bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500"
      : streak.atRisk
        ? "bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300"
        : "bg-iris-500/15 text-iris-600 dark:text-iris-300";
  return (
    <span
      className={`mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}
      aria-label={`${n} day streak${streak.atRisk ? ", at risk — do one thing today" : ""}`}
    >
      <Footprints size={12} aria-hidden="true" />
      {n} day{n === 1 ? "" : "s"}
      {streak.atRisk ? " · at risk" : ""}
    </span>
  );
}

function Row({ item, note, onToggle, onEdit, onSkip, showReason }) {
  const isStep = item.kind === "step";
  const done = item.status === "done";
  const [noteOpen, setNoteOpen] = useState(false);
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
      {/* no busy gate: completions are optimistic and the write queue serializes,
          so ticking through the plan shouldn't be tap-wait-tap-wait */}
      <button
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
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
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
              className="text-trail-700 hover:underline dark:text-trail-400"
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
            <Badge className="bg-trail-50 text-trail-700 dark:bg-slate-800 dark:text-trail-300">
              <Repeat size={11} /> {item.recurrence}
            </Badge>
          ) : null}
          {minutes(item.estMin) ? (
            <span className="inline-flex items-center gap-1">
              <Clock size={11} /> {minutes(item.estMin)}
            </span>
          ) : null}
          {reason ? <Badge className={reason.cls}>{reason.label}</Badge> : null}
          {note ? (
            <button
              onClick={() => setNoteOpen((v) => !v)}
              aria-label={noteOpen ? "Hide note" : "Show note"}
              aria-expanded={noteOpen}
              className="inline-flex items-center p-0.5 text-iris-500 transition hover:text-iris-600 dark:text-iris-300 dark:hover:text-iris-200"
            >
              <StickyNote size={12} />
            </button>
          ) : null}
        </div>
        {note && noteOpen ? (
          <p className="mt-1.5 whitespace-pre-wrap rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
            {note}
          </p>
        ) : null}
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

function Section({ title, icon: Icon, items, noteOf, onToggle, onEdit, tint = "text-slate-400" }) {
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
            note={noteOf?.(it)}
            onToggle={onToggle}
            onEdit={onEdit}
          />
        ))}
      </Card>
    </div>
  );
}

const BUDGETS = [30, 60, 90, 120];

function PlanCard({ ctx, noteOf, onEdit, onToggle, species, speaks }) {
  const { plan, save, replan, skipPlanItem, aiEnabled, busy } = ctx;
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
      <div className="flex items-center justify-between gap-2 border-b border-trail-100/80 bg-trail-50 px-4 py-3 dark:border-trail-900/60 dark:bg-trail-950/40">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-100">
            <Sparkles size={16} className="text-iris-500 dark:text-iris-300" /> Your day
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
        <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
          {/* speaks only when the header mascot isn't already talking a nudge —
              one talking mascot per screen */}
          {speaks ? (
            <CoachBubble species={species} mood="idle" size={56} side="right">
              nothing to plan yet — add a task, or line up a step.
            </CoachBubble>
          ) : (
            <>
              <Mascot species={species} mood="idle" size={56} />
              <p className="text-sm text-slate-400">
                Nothing to plan yet — add a task or line up a few roadmap steps, and the path
                appears.
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {plan.items.map((it) => (
            <Row
              key={`${it.kind}_${it.id}`}
              item={it}
              note={noteOf?.(it)}
              onToggle={onToggle}
              onEdit={onEdit}
              onSkip={(x) => skipPlanItem(x.kind, x.id, true)}
              showReason
            />
          ))}
          <button
            onClick={oneMore}
            disabled={busy}
            className="flex w-full items-center justify-center gap-1.5 py-2.5 text-xs font-medium text-slate-400 hover:text-trail-700 dark:hover:text-trail-400"
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
    warn: "text-rose-600 dark:text-rose-400",
    good: "text-trail-700 dark:text-trail-400",
    info: "text-iris-600 dark:text-iris-300",
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
  const [showBacklog, setShowBacklog] = useState(false);
  const [editTask, setEditTask] = useState(null);
  const submitting = useRef(false); // blocks a double Enter from adding twice

  // companion state: every optimistic tick bumps `burst` (replays the hop) and
  // flashes a happy beat over whatever ambient mood is showing; the completions
  // *confirmed* this session feed the "locked in" streak-of-completions detection
  const [burst, setBurst] = useState(0);
  const [flash, setFlash] = useState(false);
  const flashTimer = useRef(null);
  // one {key, t} per confirmed completion — in-memory only, resets with the session
  const doneTimes = useRef([]);
  // the clock "locked in" is derived against: bumped on each confirmed completion
  // and by the interval below, so the mood lapses without any user interaction
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => () => clearTimeout(flashTimer.current), []);
  useEffect(() => {
    // tick only while a completion is still inside the window — an idle Today
    // carries no interval at all
    if (!doneTimes.current.some((e) => now - e.t < 3600000)) {
      return undefined;
    }
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, [now]);
  const toggle = async (kind, id, done) => {
    if (done) {
      // the hop and the happy flash stay optimistic — instant feedback on tap
      setBurst((b) => b + 1);
      setFlash(true);
      clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlash(false), 1100);
    }
    const ok = await complete(kind, id, done);
    if (done && ok) {
      // counted only once the server confirms; prune the window on each push and
      // dedupe by item, so un-ticking and re-ticking the same thing doesn't stack
      const t = Date.now();
      const key = `${kind}:${id}`;
      const kept = doneTimes.current.filter((e) => t - e.t < 3600000);
      if (!kept.some((e) => e.key === key)) {
        kept.push({ key, t });
      }
      doneTimes.current = kept;
      setNow(t);
    }
    return ok;
  };

  // open the editor with the full stored task (the queue item is a lean projection)
  const openEdit = (item) => {
    const full = (state.tasks || []).find((t) => t.id === item.id);
    setEditTask(full || item);
  };

  // plan/queue items are lean projections without notes — resolve them from state
  const noteFor = (item) => {
    const rows = item.kind === "step" ? state.steps : state.tasks;
    return (rows || []).find((x) => x.id === item.id)?.notes || null;
  };

  if (!today) {
    return null;
  }

  const submit = async (e) => {
    e.preventDefault();
    if (submitting.current || !text.trim()) {
      return;
    }
    // parse natural language: "read SPI 30m tomorrow" → title + due + estimate + repeat
    const p = parseQuickAdd(text, { today: today.day });
    const title = p.title || text.trim();
    submitting.current = true;
    const ok = await addTask({
      id: uid("task"),
      status: "todo",
      title,
      due: p.due || (p.recurrence ? null : today.day),
      estMin: p.estMin ?? null,
      recurrence: p.recurrence ?? null,
    });
    submitting.current = false;
    if (ok !== false) {
      setText(""); // only on success — a failed add keeps the text for retry
    }
  };

  const goal = momentum?.dailyGoal ?? 3;
  const did = momentum?.todayCount ?? 0;
  const browseCount = today.overdue.length + today.dueToday.length + today.suggested.length;
  const openTasks = (state.tasks || []).filter((t) => t.status !== "done").length;
  const species = state.profile?.mascot;

  // "locked in": 3+ confirmed completions inside the last hour, this session.
  // Ambient state — the celebrate (goal met) and sleepy (streak at risk) moods still
  // take precedence, and the happy flash rides on top of it for a beat after each tick.
  const locked = doneTimes.current.filter((e) => now - e.t < 3600000).length >= 3;
  const mood =
    did >= goal
      ? "celebrate"
      : momentum?.streak?.atRisk
        ? "sleepy"
        : flash
          ? "happy"
          : locked
            ? "locked"
            : did >= 1
              ? "happy"
              : "idle";

  // when there's a nudge, the header mascot steps down a line and *speaks* the top
  // one (real text, replacing the first plain nudge row); the rest keep the compact
  // list. At-risk streaks keep the sleepy mood — a worried coach, not a cheery one.
  const topNudge = ctx.nudges?.[0];

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <ProgressRing done={did} goal={goal} />
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
            {greeting()}
            {ctx.state.profile?.name ? `, ${ctx.state.profile.name}` : ""}.
          </h2>
          <p className="text-sm text-slate-500">
            {did >= goal ? (
              <span className="text-iris-600 dark:text-iris-300">
                Goal met — {did} done today. The path continues tomorrow.
              </span>
            ) : (
              <>
                You&apos;ve done {did} of {goal} — here&apos;s a doable plan.
              </>
            )}
          </p>
          <StreakChip streak={momentum?.streak} />
        </div>
        {topNudge ? null : <Mascot species={species} mood={mood} burst={burst} size={64} />}
      </div>

      {topNudge ? (
        <div className="flex justify-end">
          <CoachBubble species={species} mood={mood} burst={burst} size={60} side="right">
            {topNudge.text}
          </CoachBubble>
        </div>
      ) : null}
      <Nudges items={topNudge ? ctx.nudges.slice(1) : ctx.nudges} />

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

      {openTasks > 0 ? (
        <div className="-mt-2 flex justify-end">
          <button
            onClick={() => setShowBacklog(true)}
            className="inline-flex items-center gap-1 px-1 text-xs font-medium text-slate-400 transition hover:text-trail-700 dark:hover:text-trail-400"
          >
            <ListTodo size={13} /> All tasks · {openTasks} →
          </button>
        </div>
      ) : null}

      <PlanCard
        ctx={ctx}
        noteOf={noteFor}
        onEdit={openEdit}
        onToggle={toggle}
        species={species}
        speaks={!topNudge}
      />

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
                noteOf={noteFor}
                onToggle={toggle}
                onEdit={openEdit}
                tint="text-rose-500"
              />
              <Section
                title="Due today"
                icon={CircleDot}
                items={today.dueToday}
                noteOf={noteFor}
                onToggle={toggle}
                onEdit={openEdit}
              />
              <Section
                title="Suggested next steps"
                icon={Sparkles}
                items={today.suggested}
                noteOf={noteFor}
                onToggle={toggle}
                tint="text-trail-700 dark:text-trail-400"
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
                <Row key={`${it.kind}_${it.id}`} item={it} onToggle={toggle} />
              ))}
            </Card>
          ) : null}
        </div>
      ) : null}

      {showNew ? <TaskModal ctx={ctx} onClose={() => setShowNew(false)} /> : null}
      {editTask ? <TaskModal ctx={ctx} task={editTask} onClose={() => setEditTask(null)} /> : null}
      {showBacklog ? <Backlog ctx={ctx} onClose={() => setShowBacklog(false)} /> : null}
    </div>
  );
}
