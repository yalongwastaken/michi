import { useMemo, useState } from "react";
import { Target, Plus, Pencil, Trophy, RotateCcw, Link2 } from "lucide-react";
import {
  Card,
  Button,
  IconButton,
  Badge,
  Field,
  Input,
  Textarea,
  Modal,
  ConfirmButton,
  EmptyState,
} from "../ui.jsx";
import { uid } from "../lib/uid.js";
import { deleteGoal } from "../lib/mutate.js";
import { todayKey, shortDate } from "../lib/format.js";
import { confettiBurst } from "../lib/celebrate.js";

// contribution strip: trail-green intensity per day, mirroring Home's heatmap ramp
function heatColor(count) {
  if (!count) {
    return "bg-slate-100 dark:bg-slate-800";
  }
  if (count === 1) {
    return "bg-trail-200 dark:bg-trail-900";
  }
  if (count === 2) {
    return "bg-trail-400 dark:bg-trail-700";
  }
  return "bg-trail-600";
}

// a compact weeks-in-columns strip (like Home's, tuned small for a goal card)
function ContribStrip({ heat = [] }) {
  const first = heat[0]?.date;
  const lead = first ? new Date(`${first}T12:00:00Z`).getUTCDay() : 0;
  const cells = [...Array(lead).fill(null), ...heat];
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }
  return (
    <div className="flex gap-0.5 overflow-x-auto" aria-hidden="true">
      {weeks.map((week, wi) => (
        <div key={wi} className="flex flex-col gap-0.5">
          {week.map((cell, di) => (
            <div
              key={di}
              title={cell ? `${shortDate(cell.date)} · ${cell.count}` : ""}
              className={`h-2 w-2 rounded-[2px] ${cell ? heatColor(cell.count) : "bg-transparent"}`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function lastActiveLabel(day, today) {
  if (!day) {
    return "no work logged yet";
  }
  if (day === today) {
    return "worked today";
  }
  const diff = Math.round(
    (new Date(`${today}T12:00:00Z`) - new Date(`${day}T12:00:00Z`)) / 86400000,
  );
  if (diff === 1) {
    return "worked yesterday";
  }
  return `last worked ${diff}d ago`;
}

// one overarching goal: its progress (completions attributed to it) + the actions
function GoalCard({ ctx, goal, progress, onEdit, onAssign }) {
  const { save, busy } = ctx;
  const today = ctx.day || todayKey();
  const p = progress || { count: 0, activeDays: 0, lastDay: null, heat: [] };
  const achieved = goal.status === "achieved";

  const setAchieved = async (on) => {
    const ok = await save((s) => {
      const g = (s.goals || []).find((x) => x.id === goal.id);
      if (g) {
        g.status = on ? "achieved" : "active";
        g.achievedAt = on ? new Date().toISOString() : null;
      }
    });
    if (on && ok !== false) {
      confettiBurst(); // a small, earned burst — a goal like "climb V10" is a big deal
    }
  };

  return (
    <Card className={`p-4 ${achieved ? "opacity-80" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-100">
            {achieved ? (
              <Trophy size={15} className="shrink-0 text-iris-500" />
            ) : (
              <Target size={15} className="shrink-0 text-trail-600 dark:text-trail-400" />
            )}
            <span className="truncate">{goal.title}</span>
          </h4>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            {goal.area ? (
              <Badge className="bg-trail-500/15 text-trail-700 dark:text-trail-300">
                {goal.area}
              </Badge>
            ) : null}
            {achieved ? (
              <Badge className="bg-iris-500/15 text-iris-600 dark:text-iris-300">Achieved</Badge>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <IconButton label="Edit goal" onClick={onEdit} disabled={busy}>
            <Pencil size={15} />
          </IconButton>
        </div>
      </div>

      {goal.note ? <p className="mt-2 text-sm text-slate-500">{goal.note}</p> : null}

      <div className="mt-3 flex items-end justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-slate-700 dark:text-slate-200">
            {p.count} done
            {p.activeDays ? (
              <span className="ml-1.5 text-xs font-normal text-slate-400">
                · {p.activeDays} active day{p.activeDays === 1 ? "" : "s"}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-xs text-slate-400">{lastActiveLabel(p.lastDay, today)}</p>
        </div>
        {p.heat?.length ? <ContribStrip heat={p.heat} /> : null}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="ghost" className="h-8 px-2 text-sm" onClick={onAssign} disabled={busy}>
          <Link2 size={14} /> Add work
        </Button>
        {achieved ? (
          <Button
            variant="ghost"
            className="h-8 px-2 text-sm"
            onClick={() => setAchieved(false)}
            disabled={busy}
          >
            <RotateCcw size={14} /> Reopen
          </Button>
        ) : (
          <Button
            variant="ghost"
            className="h-8 px-2 text-sm"
            onClick={() => setAchieved(true)}
            disabled={busy}
          >
            <Trophy size={14} /> Mark achieved
          </Button>
        )}
        <ConfirmButton
          label="Delete goal"
          confirm="Delete this goal?"
          onConfirm={() => save((s) => deleteGoal(s, goal.id))}
          disabled={busy}
          className="ml-auto h-8 px-2 text-sm"
        >
          Delete
        </ConfirmButton>
      </div>
    </Card>
  );
}

// add / edit a goal (title, area, note)
function GoalModal({ ctx, goal = null, onClose }) {
  const editing = !!goal;
  const { save, busy } = ctx;
  const [title, setTitle] = useState(goal?.title || "");
  const [area, setArea] = useState(goal?.area || "");
  const [note, setNote] = useState(goal?.note || "");

  const submit = async () => {
    if (!title.trim()) {
      return;
    }
    const ok = await save((s) => {
      s.goals = s.goals || [];
      if (editing) {
        const g = s.goals.find((x) => x.id === goal.id);
        if (g) {
          g.title = title.trim();
          g.area = area.trim() || null;
          g.note = note.trim() || null;
        }
      } else {
        s.goals.push({
          id: uid("goal"),
          title: title.trim(),
          area: area.trim() || null,
          note: note.trim() || null,
          status: "active",
          position: s.goals.length,
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
      title={editing ? "Edit goal" : "New goal"}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !title.trim()}>
            {editing ? "Save" : "Add"}
          </Button>
        </>
      }
    >
      <Field label="Goal">
        <Input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Climb V10 · Reach Japanese N1"
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
      </Field>
      <Field label="Area" hint="Optional — a loose grouping like “Climbing” or “Japanese”.">
        <Input value={area} onChange={(e) => setArea(e.target.value)} placeholder="—" />
      </Field>
      <Field label="Note">
        <Textarea
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="what reaching this looks like…"
        />
      </Field>
    </Modal>
  );
}

// attribute completed work to a goal: pick from finished tasks/steps (and detach
// any already on this goal). Attribution is retroactive — the server credits the
// whole history of whatever you attach.
function AssignModal({ ctx, goal, onClose }) {
  const { state, save, busy } = ctx;

  // step → its milestone/roadmap titles, for a little context in the list
  const stepCtx = useMemo(() => {
    const mById = new Map((state.milestones || []).map((m) => [m.id, m]));
    const rById = new Map((state.roadmaps || []).map((r) => [r.id, r]));
    const map = new Map();
    for (const s of state.steps || []) {
      const m = mById.get(s.milestoneId);
      const r = m && rById.get(m.roadmapId);
      map.set(s.id, [r?.title, m?.title].filter(Boolean).join(" · "));
    }
    return map;
  }, [state.milestones, state.roadmaps, state.steps]);

  // candidates: attributed-to-this-goal (so you can detach) OR completed + unassigned
  const done = (it) => it.status === "done" || !!it.doneAt;
  const rows = useMemo(() => {
    const items = [];
    for (const t of state.tasks || []) {
      if (t.goalId === goal.id || (done(t) && !t.goalId)) {
        items.push({ kind: "task", id: t.id, title: t.title, sub: "task", doneAt: t.doneAt });
      }
    }
    for (const s of state.steps || []) {
      if (s.goalId === goal.id || (done(s) && !s.goalId)) {
        items.push({
          kind: "step",
          id: s.id,
          title: s.title,
          sub: stepCtx.get(s.id) || "step",
          doneAt: s.doneAt,
        });
      }
    }
    // most-recently finished first; undated (attributed but reset) sink to the end
    return items.sort((a, b) => (b.doneAt || "").localeCompare(a.doneAt || ""));
  }, [state.tasks, state.steps, stepCtx, goal.id]);

  const initial = useMemo(() => {
    const set = new Set();
    for (const t of state.tasks || []) {
      if (t.goalId === goal.id) {
        set.add(`task:${t.id}`);
      }
    }
    for (const s of state.steps || []) {
      if (s.goalId === goal.id) {
        set.add(`step:${s.id}`);
      }
    }
    return set;
  }, [state.tasks, state.steps, goal.id]);

  const [checked, setChecked] = useState(initial);
  const toggle = (key) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });

  const submit = async () => {
    const ok = await save((s) => {
      for (const t of s.tasks || []) {
        const key = `task:${t.id}`;
        if (checked.has(key)) {
          t.goalId = goal.id;
        } else if (t.goalId === goal.id) {
          t.goalId = null; // detached in this dialog
        }
      }
      for (const st of s.steps || []) {
        const key = `step:${st.id}`;
        if (checked.has(key)) {
          st.goalId = goal.id;
        } else if (st.goalId === goal.id) {
          st.goalId = null;
        }
      }
    });
    if (ok !== false) {
      onClose();
    }
  };

  return (
    <Modal
      title={`Add work to “${goal.title}”`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            Save
          </Button>
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState title="Nothing finished to attribute yet">
          Complete a task or a roadmap step and it’ll show up here to add toward this goal.
        </EmptyState>
      ) : (
        <ul className="-mx-1 max-h-80 space-y-0.5 overflow-y-auto">
          {rows.map((it) => {
            const key = `${it.kind}:${it.id}`;
            return (
              <li key={key}>
                <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800">
                  <input
                    type="checkbox"
                    className="h-4 w-4 shrink-0 accent-trail-600"
                    checked={checked.has(key)}
                    onChange={() => toggle(key)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-slate-700 dark:text-slate-200">
                      {it.title}
                    </span>
                    <span className="block truncate text-xs text-slate-400">{it.sub}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}

/**
 * The overarching-goals section for the Progress tab: the long-horizon aspirations
 * ("climb V10", "Japanese N1"), each showing the completed work attributed to it as
 * a running progress feed.
 */
export default function Goals({ ctx }) {
  const goals = ctx.state?.goals || [];
  const progress = ctx.goalProgress || {};
  const [editing, setEditing] = useState(null); // goal being edited, or "new"
  const [assigning, setAssigning] = useState(null); // goal to attribute work to

  // active goals first, achieved sink below, each keeping its saved order
  const ordered = [...goals].sort((a, b) => {
    const rank = (g) => (g.status === "achieved" ? 1 : 0);
    return rank(a) - rank(b) || (a.position ?? 0) - (b.position ?? 0);
  });

  return (
    <div>
      <div className="mb-2 flex items-center justify-between px-1">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Goals</h3>
        <IconButton label="New goal" onClick={() => setEditing("new")} disabled={ctx.busy}>
          <Plus size={16} />
        </IconButton>
      </div>

      {ordered.length === 0 ? (
        <EmptyState
          icon={Target}
          title="No goals yet"
          action={
            <Button variant="ghost" onClick={() => setEditing("new")}>
              <Plus size={15} /> Add a goal
            </Button>
          }
        >
          Set a long-horizon goal like “climb V10”, then attribute finished work to watch steady
          progress add up.
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {ordered.map((g) => (
            <GoalCard
              key={g.id}
              ctx={ctx}
              goal={g}
              progress={progress[g.id]}
              onEdit={() => setEditing(g)}
              onAssign={() => setAssigning(g)}
            />
          ))}
        </div>
      )}

      {editing ? (
        <GoalModal
          ctx={ctx}
          goal={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {assigning ? (
        <AssignModal ctx={ctx} goal={assigning} onClose={() => setAssigning(null)} />
      ) : null}
    </div>
  );
}
