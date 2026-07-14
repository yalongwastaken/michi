// Backlog.jsx — the full task list, one sheet for triage: filter, tick, nudge
// dates forward, or tap through to the full editor. Opened from Today.
import { useState } from "react";
import { Check, Clock, Repeat, BookOpen, Hammer } from "lucide-react";
import { Modal } from "../ui.jsx";
import { dueLabel, minutes, shortDate, addDays } from "../lib/format.js";
import TaskModal from "./TaskModal.jsx";
import CoachBubble from "./CoachBubble.jsx";

const FILTERS = [
  ["overdue", "Overdue"],
  ["today", "Today"],
  ["upcoming", "Upcoming"],
  ["undated", "Undated"],
  ["done", "Done"],
];

/** Which filter bucket a task falls in, relative to the current day. */
export function bucketOf(t, day) {
  if (t.status === "done") {
    return "done";
  }
  if (!t.due) {
    return "undated";
  }
  if (t.due < day) {
    return "overdue";
  }
  if (t.due === day) {
    return "today";
  }
  return "upcoming";
}

// triage order: overdue first (oldest due leads), then dated ascending, undated last
function compare(a, b) {
  if (!a.due && !b.due) {
    return 0;
  }
  if (!a.due) {
    return 1;
  }
  if (!b.due) {
    return -1;
  }
  return a.due < b.due ? -1 : a.due > b.due ? 1 : 0;
}

function BacklogRow({ t, day, done, onToggle, onOpen, onReschedule, busy }) {
  const overdue = !done && t.due && t.due < day;
  return (
    <div className="flex items-center gap-2.5 py-2">
      <button
        onClick={() => onToggle(t, !done)}
        aria-label={done ? "Mark not done" : "Mark done"}
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition ${
          done
            ? "border-trail-500 bg-trail-500 text-white"
            : "border-slate-300 text-transparent hover:border-trail-400 dark:border-slate-600"
        }`}
      >
        <Check size={12} strokeWidth={3} />
      </button>
      <button onClick={() => onOpen(t)} className="min-w-0 flex-1 text-left">
        <span
          className={`block truncate text-sm font-medium ${
            done ? "text-slate-400 line-through" : "text-slate-800 dark:text-slate-100"
          }`}
        >
          {t.title}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
          {done && t.doneAt ? <span>done {shortDate(t.doneAt)}</span> : null}
          {!done && t.due ? (
            <span className={overdue ? "font-medium text-rose-500" : ""}>{dueLabel(t.due)}</span>
          ) : null}
          {t.recurrence ? (
            <span className="inline-flex items-center gap-0.5">
              <Repeat size={10} aria-label="repeats" /> {t.recurrence}
            </span>
          ) : null}
          {minutes(t.estMin) ? (
            <span className="inline-flex items-center gap-0.5">
              <Clock size={10} /> {minutes(t.estMin)}
            </span>
          ) : null}
          {t.linked ? (
            <span className="inline-flex min-w-0 items-center gap-0.5">
              {t.linked.kind === "step" ? <BookOpen size={10} /> : <Hammer size={10} />}
              <span className="truncate">{t.linked.label}</span>
            </span>
          ) : null}
        </span>
      </button>
      {!done ? (
        <span className="flex shrink-0 items-center gap-0.5" aria-label={`Reschedule ${t.title}`}>
          {[
            ["Today", 0],
            ["+1d", 1],
            ["+1w", 7],
          ].map(([label, days]) => (
            <button
              key={label}
              disabled={busy}
              onClick={() => onReschedule(t, addDays(day, days))}
              aria-label={`Reschedule to ${label === "Today" ? "today" : label === "+1d" ? "tomorrow" : "next week"}`}
              className="rounded-md px-1.5 py-1 text-[11px] font-medium text-slate-400 transition hover:bg-slate-100 hover:text-trail-700 disabled:opacity-40 dark:hover:bg-slate-800 dark:hover:text-trail-400"
            >
              {label}
            </button>
          ))}
        </span>
      ) : null}
    </div>
  );
}

export default function Backlog({ ctx, onClose }) {
  const { state, day, complete, save, busy } = ctx;
  const [filter, setFilter] = useState(null); // null = everything active (not done)
  const [editTask, setEditTask] = useState(null);
  // optimistic status flips so ticking feels instant; state truth reconciles after
  const [flips, setFlips] = useState({});

  const steps = state.steps || [];
  const milestones = state.milestones || [];
  const roadmaps = state.roadmaps || [];
  const projects = state.projects || [];

  // "linked to" label: the step's roadmap · step, or the project name
  const linkedOf = (t) => {
    if (t.stepId) {
      const st = steps.find((s) => s.id === t.stepId);
      if (st) {
        const ms = milestones.find((m) => m.id === st.milestoneId);
        const rm = ms && roadmaps.find((r) => r.id === ms.roadmapId);
        return { kind: "step", label: rm ? `${rm.title} · ${st.title}` : st.title };
      }
    }
    if (t.projectId) {
      const p = projects.find((x) => x.id === t.projectId);
      if (p) {
        return { kind: "project", label: p.title };
      }
    }
    return null;
  };

  const tasks = (state.tasks || []).map((t) => ({
    ...t,
    status: flips[t.id] ?? t.status,
    linked: linkedOf(t),
  }));
  const open = tasks.filter((t) => t.status !== "done");
  const overdueCount = open.filter((t) => bucketOf(t, day) === "overdue").length;

  const shown = tasks
    .filter((t) => (filter ? bucketOf(t, day) === filter : t.status !== "done"))
    .sort(filter === "done" ? (a, b) => ((a.doneAt || "") < (b.doneAt || "") ? 1 : -1) : compare);

  const toggle = async (t, done) => {
    setFlips((f) => ({ ...f, [t.id]: done ? "done" : "todo" }));
    const ok = await complete("task", t.id, done);
    // state now carries the truth (success or reverted) — drop the local flip
    setFlips((f) => {
      const rest = { ...f };
      delete rest[t.id];
      return rest;
    });
    return ok;
  };

  const reschedule = (t, due) =>
    save((s) => {
      const x = s.tasks.find((y) => y.id === t.id);
      if (x) {
        x.due = due;
      }
    });

  // open the editor with the stored task (our copy carries display-only extras)
  const openEdit = (t) => setEditTask((state.tasks || []).find((x) => x.id === t.id) || t);

  return (
    <>
      {/* while the task editor is stacked on top, Escape should close it — not the sheet */}
      <Modal title="All tasks" onClose={editTask ? () => setEditTask(null) : onClose}>
        <p className="-mt-3 text-xs text-slate-400">
          {open.length} open{overdueCount ? ` · ${overdueCount} overdue` : ""}
        </p>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter tasks">
          {FILTERS.map(([id, label]) => (
            <button
              key={id}
              onClick={() => setFilter((f) => (f === id ? null : id))}
              aria-pressed={filter === id}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                filter === id
                  ? "bg-trail-600 text-white"
                  : "bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {shown.length === 0 ? (
          filter && filter !== "done" ? (
            <div className="flex justify-center py-6">
              <CoachBubble species={state.profile?.mascot} mood="idle" size={44} side="left">
                nothing here — the path is clear.
              </CoachBubble>
            </div>
          ) : (
            <p className="py-6 text-center text-sm text-slate-400">
              {filter === "done"
                ? "Nothing finished yet — the first tick starts the pile."
                : "No open tasks — add one from Today and it lands here."}
            </p>
          )
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {shown.map((t) => (
              <BacklogRow
                key={t.id}
                t={t}
                day={day}
                done={t.status === "done"}
                onToggle={toggle}
                onOpen={openEdit}
                onReschedule={reschedule}
                busy={busy}
              />
            ))}
          </div>
        )}
      </Modal>
      {editTask ? <TaskModal ctx={ctx} task={editTask} onClose={() => setEditTask(null)} /> : null}
    </>
  );
}
