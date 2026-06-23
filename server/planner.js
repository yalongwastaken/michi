// planner.js — Michi's day planner. Looks at the *whole* picture (everything due,
// what's in progress, which roadmaps are being neglected, the streak) and assembles
// a doable day that fits a time budget. Pure + deterministic, so it works on any
// hardware with no dependencies; an optional local model can refine its output later
// (see suggest.js), but the planner is always the dependable fallback.
import { dayKey } from "./engine.js";

/** Lightweight projections the client renders (mirrors the Today queue shapes). */
function stepLine(step, milestone, roadmap, reason, estMin) {
  return {
    kind: "step",
    id: step.id,
    title: step.title,
    status: step.status,
    resourceUrl: step.resourceUrl || null,
    roadmapId: roadmap.id,
    roadmapTitle: roadmap.title,
    roadmapColor: roadmap.color || null,
    milestoneTitle: milestone.title,
    reason,
    estMin,
  };
}
function taskLine(task, reason, estMin) {
  return {
    kind: "task",
    id: task.id,
    title: task.title,
    status: task.status,
    due: task.due || null,
    recurrence: task.recurrence || null,
    stepId: task.stepId || null,
    projectId: task.projectId || null,
    reason,
    estMin,
  };
}

/** Map each step id → its roadmap id (via its milestone). */
function stepToRoadmap(state) {
  const mToR = new Map((state.milestones || []).map((m) => [m.id, m.roadmapId]));
  const map = new Map();
  for (const s of state.steps || []) {
    const rid = mToR.get(s.milestoneId);
    if (rid) {
      map.set(s.id, rid);
    }
  }
  return map;
}

/** Most recent local day each roadmap saw activity (from the completion log). */
function lastActiveByRoadmap(state, s2r) {
  const last = new Map();
  const bump = (rid, day) => {
    if (!rid || !day) {
      return;
    }
    const cur = last.get(rid);
    if (!cur || day > cur) {
      last.set(rid, day);
    }
  };
  const taskRoadmap = new Map(); // task.stepId → roadmap, so task completions count too
  for (const t of state.tasks || []) {
    if (t.stepId && s2r.has(t.stepId)) {
      taskRoadmap.set(t.id, s2r.get(t.stepId));
    }
  }
  for (const c of state.completions || []) {
    if (c.kind === "step") {
      bump(s2r.get(c.refId), c.day);
    } else if (c.kind === "task") {
      bump(taskRoadmap.get(c.refId), c.day);
    }
  }
  return last;
}

/**
 * Build a doable day.
 * @param {Object} state full model from db.getState()
 * @param {Object} [opts]
 *   today         YYYY-MM-DD (default server-local)
 *   budgetMin     time budget for the day in minutes (default 60)
 *   defaultStepMin per-step estimate when a step has none (default 30)
 *   taskDefaultMin per-task estimate when a task has none (default 20)
 * @returns {{day, budgetMin, plannedMin, overflow, items:Array, why:string,
 *            counts:{due:number,continue:number,rotate:number}}}
 */
export function planDay(state, opts = {}) {
  const today = opts.today || dayKey();
  const budgetMin = Number.isFinite(opts.budgetMin) ? opts.budgetMin : 60;
  const defaultStepMin = Number.isFinite(opts.defaultStepMin) ? opts.defaultStepMin : 30;
  const taskDefaultMin = Number.isFinite(opts.taskDefaultMin) ? opts.taskDefaultMin : 20;

  const tasks = state.tasks || [];
  const roadmaps = (state.roadmaps || []).filter((r) => !r.archived);
  const milestones = state.milestones || [];
  const steps = state.steps || [];

  const s2r = stepToRoadmap(state);
  const lastActive = lastActiveByRoadmap(state, s2r);

  const items = [];
  let used = 0;
  const taskMin = (t) => (Number.isFinite(Number(t.estMin)) ? Number(t.estMin) : taskDefaultMin);

  // ── 1. obligations: overdue + due-today tasks (recurring tasks due today too).
  //        always included — you can't budget your way out of a deadline.
  const isDoneToday = (t) => t.status === "done" && (t.doneAt || "").slice(0, 10) === today;
  const dueDow = new Date(`${today}T12:00:00Z`).getUTCDay();
  const recurringDue = (t) =>
    t.recurrence === "daily" ||
    (t.recurrence === "weekdays" && dueDow >= 1 && dueDow <= 5) ||
    (t.recurrence === "weekly" && t.due && new Date(`${t.due}T12:00:00Z`).getUTCDay() === dueDow);

  for (const t of tasks) {
    if (isDoneToday(t)) {
      continue;
    }
    const obligated =
      (!t.recurrence && t.status !== "done" && t.due && t.due <= today) ||
      (!!t.recurrence && recurringDue(t));
    if (obligated) {
      const mins = taskMin(t);
      items.push(taskLine(t, t.due && t.due < today ? "overdue" : "due", mins));
      used += mins;
    }
  }

  const remaining = () => budgetMin - used;

  // ── 2. ordered not-done steps per roadmap (milestone order, then step order) ──
  const queues = new Map(); // roadmapId → [stepLine candidates], "doing" first
  for (const r of roadmaps) {
    const rms = milestones
      .filter((m) => m.roadmapId === r.id)
      .sort((a, b) => a.position - b.position);
    const q = [];
    for (const m of rms) {
      for (const s of steps
        .filter((x) => x.milestoneId === m.id && x.status !== "done")
        .sort((a, b) => a.position - b.position)) {
        q.push(stepLine(s, m, r, "rotate", defaultStepMin));
      }
    }
    // continuity: a step already "in progress" should be finished first
    q.sort((a, b) => (b.status === "doing") - (a.status === "doing"));
    if (q.length) {
      queues.set(r.id, q);
    }
  }

  // roadmap visiting order: most-neglected first (never-touched = most neglected),
  // tie-broken by lower progress so stalled paths resurface
  const order = [...queues.keys()].sort((a, b) => {
    const la = lastActive.get(a);
    const lb = lastActive.get(b);
    if (la !== lb) {
      if (!la) {
        return -1;
      }
      if (!lb) {
        return 1;
      }
      return la < lb ? -1 : 1;
    }
    return 0;
  });

  // ── 3. round-robin fill across roadmaps until the budget is spent ──
  let progress = true;
  while (remaining() >= defaultStepMin && progress) {
    progress = false;
    for (const rid of order) {
      const q = queues.get(rid);
      if (q && q.length && remaining() >= defaultStepMin) {
        items.push(q.shift());
        used += defaultStepMin;
        progress = true;
      }
    }
  }

  // ── 4. streak protection: never hand back an empty day if there's anything to do ──
  if (items.length === 0) {
    for (const rid of order) {
      const q = queues.get(rid);
      if (q && q.length) {
        const it = q.shift();
        it.reason = "streak";
        items.push(it);
        used += it.estMin;
        break;
      }
    }
  }

  const counts = { due: 0, continue: 0, rotate: 0 };
  for (const it of items) {
    if (it.reason === "due" || it.reason === "overdue") {
      counts.due += 1;
    } else if (it.status === "doing") {
      counts.continue += 1;
    } else {
      counts.rotate += 1;
    }
  }

  const roadmapsTouched = new Set(items.filter((i) => i.kind === "step").map((i) => i.roadmapId));
  const why = summarize(counts, roadmapsTouched.size, used, budgetMin, items.length);

  return {
    day: today,
    budgetMin,
    plannedMin: used,
    overflow: used > budgetMin,
    items,
    counts,
    why,
  };
}

/** One-line, human rationale for the planned day. */
function summarize(counts, roadmapCount, used, budget, total) {
  if (total === 0) {
    return "Nothing queued — add a task or a roadmap step to get a plan.";
  }
  const parts = [];
  if (counts.due) {
    parts.push(`${counts.due} due`);
  }
  const stepish = counts.continue + counts.rotate;
  if (stepish) {
    parts.push(
      `${stepish} step${stepish > 1 ? "s" : ""}${roadmapCount > 1 ? ` across ${roadmapCount} roadmaps` : ""}`,
    );
  }
  const head = parts.join(" + ") || `${total} item${total > 1 ? "s" : ""}`;
  const time = used > budget ? `~${used} min (over your ${budget})` : `~${used} of ${budget} min`;
  return `${head} — ${time}.`;
}
