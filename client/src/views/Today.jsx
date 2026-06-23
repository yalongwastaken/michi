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
} from "lucide-react";
import { Card, Button, Input, EmptyState, Badge, IconButton } from "../ui.jsx";
import { dueLabel, minutes } from "../lib/format.js";
import { uid } from "../lib/uid.js";
import TaskModal from "./TaskModal.jsx";

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

function Row({ item, onToggle, busy, onEdit }) {
  const isStep = item.kind === "step";
  const done = item.status === "done";
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
        </div>
      </div>
      {onEdit && !isStep ? (
        <IconButton
          label="Edit task"
          className="h-7 w-7 opacity-0 transition group-hover:opacity-100 focus:opacity-100"
          onClick={() => onEdit(item)}
        >
          <Pencil size={14} />
        </IconButton>
      ) : null}
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

export default function Today({ ctx }) {
  const { today, momentum, complete, addTask, busy, state } = ctx;
  const [text, setText] = useState("");
  const [showDone, setShowDone] = useState(false);
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
    const title = text.trim();
    if (!title) {
      return;
    }
    setText("");
    await addTask({ id: uid("task"), title, due: today.day });
  };

  const goal = momentum?.dailyGoal ?? 3;
  const did = momentum?.todayCount ?? 0;
  const empty = !today.overdue.length && !today.dueToday.length && !today.suggested.length;

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
              You&apos;ve done {did} of {goal} today. Pick something below.
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

      <form onSubmit={submit} className="flex gap-2">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a task for today…"
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

      {empty ? (
        <EmptyState icon={Sparkles} title="Your path is clear for today">
          Add a task above, or open Roadmaps to line up your next steps.
        </EmptyState>
      ) : (
        <div className="space-y-4">
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
      )}

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
