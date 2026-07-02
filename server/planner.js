// planner.js — Michi's day planner. Looks at the *whole* picture (everything due,
// what's in progress, deadlines, which roadmaps are neglected, the streak) and
// assembles a doable day that fits a time budget. Pure + deterministic, so it works on
// any hardware with no dependencies; an optional local model can refine its output
// (see suggest.js), but the planner is always the dependable fallback.
import { recurringDueToday } from "./engine.js";
import { dayKey, localDay, daysUntil } from "./dates.js";
import { stepLine, taskLine, stepToRoadmap, lastActiveByRoadmap } from "./project.js";

const itemKey = (kind, id) => `${kind}:${id}`;

/**
 * Lane key for loose (undated, non-recurring) tasks in the rotation pass. The lane
 * map is otherwise keyed by roadmap ids; a Symbol lives outside that string
 * namespace entirely, so no imported roadmap id can ever collide with it (the old
 * `" loose"` string sentinel merely *hoped* no roadmap would use that id).
 */
export const LOOSE_TASKS_LANE = Symbol("michi.planner.looseTasks");

/**
 * Build a doable day.
 * @param {Object} state full model from db.getState()
 * @param {Object} [opts]
 *   today          YYYY-MM-DD (default server-local)
 *   budgetMin      time budget for the day in minutes (default 60)
 *   defaultStepMin per-step estimate when a roadmap sets none (default 30)
 *   taskDefaultMin per-task estimate when a task has none (default 20)
 *   skip           iterable of "kind:id" keys to leave out today ("not today")
 */
export function planDay(state, opts = {}) {
  const today = opts.today || dayKey();
  const budgetMin = Number.isFinite(opts.budgetMin) ? opts.budgetMin : 60;
  const defaultStepMin = Number.isFinite(opts.defaultStepMin) ? opts.defaultStepMin : 30;
  const taskDefaultMin = Number.isFinite(opts.taskDefaultMin) ? opts.taskDefaultMin : 20;
  const skip = opts.skip instanceof Set ? opts.skip : new Set(opts.skip || []);
  const skipped = (kind, id) => skip.has(itemKey(kind, id));

  const tasks = state.tasks || [];
  const roadmaps = (state.roadmaps || []).filter((r) => !r.archived);
  const milestones = state.milestones || [];
  const steps = state.steps || [];

  const s2r = stepToRoadmap(state);
  const lastActive = lastActiveByRoadmap(state, s2r);

  const items = [];
  let used = 0;
  const taskMin = (t) => (Number.isFinite(Number(t.estMin)) ? Number(t.estMin) : taskDefaultMin);
  // a line's time cost — note 0 is a valid estimate, so don't fall through on it
  const cost = (line) => (Number.isFinite(line.estMin) ? line.estMin : defaultStepMin);
  const remaining = () => budgetMin - used;
  const push = (line) => {
    items.push(line);
    used += cost(line);
  };

  // ── 1. obligations: overdue + due-today tasks (recurring tasks due today too).
  //        always included — you can't budget your way out of a deadline.
  const isDoneToday = (t) => t.status === "done" && localDay(t.doneAt) === today;
  for (const t of tasks) {
    if (isDoneToday(t) || skipped("task", t.id)) {
      continue;
    }
    const obligated =
      (!t.recurrence && t.status !== "done" && t.due && t.due <= today) ||
      (!!t.recurrence && recurringDueToday(t, today));
    if (obligated) {
      push(taskLine(t, { reason: t.due && t.due < today ? "overdue" : "due", estMin: taskMin(t) }));
    }
  }

  // ── 2. per-roadmap step queues (milestone order, then step order; "doing" first) ──
  const stepCost = (r) =>
    Number.isFinite(Number(r.stepMinutes)) && Number(r.stepMinutes) > 0
      ? Number(r.stepMinutes)
      : defaultStepMin;
  // bucket milestones/steps once (O(n)) so we don't re-scan the global arrays per
  // roadmap — keeps planning linear even with many large imported roadmaps
  const msByRoadmap = new Map();
  for (const m of milestones) {
    (msByRoadmap.get(m.roadmapId) || msByRoadmap.set(m.roadmapId, []).get(m.roadmapId)).push(m);
  }
  const stepsByMs = new Map();
  for (const s of steps) {
    (stepsByMs.get(s.milestoneId) || stepsByMs.set(s.milestoneId, []).get(s.milestoneId)).push(s);
  }

  const queues = new Map(); // roadmapId → { steps:[lines], meta:{ targetDate, perDay } }
  for (const r of roadmaps) {
    const rms = (msByRoadmap.get(r.id) || []).slice().sort((a, b) => a.position - b.position);
    const q = [];
    for (const m of rms) {
      for (const s of (stepsByMs.get(m.id) || [])
        .filter((x) => x.status !== "done" && !skipped("step", x.id))
        .sort((a, b) => a.position - b.position)) {
        q.push(stepLine(s, m, r, { reason: "rotate", estMin: stepCost(r) }));
      }
    }
    q.sort((a, b) => (b.status === "doing") - (a.status === "doing"));
    if (q.length) {
      // clamp: a deadline today (or past) means "all of it, now", never ÷0
      const daysLeft = daysUntil(r.targetDate, today, { clamp: true });
      const perDay = daysLeft ? Math.ceil(q.length / daysLeft) : 0;
      queues.set(r.id, { steps: q, targetDate: r.targetDate || null, daysLeft, perDay });
    }
  }

  // ── 3a. pacing pass — roadmaps with a deadline, most-urgent first, take `perDay` ──
  const deadlineIds = [...queues.keys()]
    .filter((id) => queues.get(id).targetDate)
    .sort((a, b) => queues.get(a).daysLeft - queues.get(b).daysLeft);
  for (const id of deadlineIds) {
    const q = queues.get(id);
    for (let i = 0; i < q.perDay && q.steps.length; i++) {
      if (remaining() < cost(q.steps[0])) {
        break;
      }
      const line = q.steps.shift();
      line.reason = "pace";
      push(line);
    }
  }

  // ── 3b. rotation pass — remaining lanes by neglect (never-touched first), then
  //         leftover round-robin to spend the rest of the budget ──
  const rotateIds = [...queues.keys()].sort((a, b) => {
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

  const loose = tasks
    .filter((t) => !t.recurrence && t.status !== "done" && !t.due && !skipped("task", t.id))
    .map((t) => taskLine(t, { reason: "rotate", estMin: taskMin(t) }));
  const laneOrder = [...rotateIds];
  if (loose.length) {
    queues.set(LOOSE_TASKS_LANE, { steps: loose });
    laneOrder.push(LOOSE_TASKS_LANE);
  }

  let progress = true;
  while (remaining() > 0 && progress) {
    progress = false;
    for (const lane of laneOrder) {
      const q = queues.get(lane)?.steps;
      if (q && q.length && remaining() >= cost(q[0])) {
        push(q.shift());
        progress = true;
      }
    }
  }

  // ── 4. streak protection: never hand back an empty day if there's anything to do ──
  if (items.length === 0) {
    for (const lane of [...deadlineIds, ...laneOrder]) {
      const q = queues.get(lane)?.steps;
      if (q && q.length) {
        const line = q.shift();
        line.reason = "streak";
        push(line);
        break;
      }
    }
  }

  const counts = { due: 0, pace: 0, continue: 0, rotate: 0 };
  for (const it of items) {
    if (it.reason === "due" || it.reason === "overdue") {
      counts.due += 1;
    } else if (it.reason === "pace") {
      counts.pace += 1;
    } else if (it.status === "doing") {
      counts.continue += 1;
    } else {
      counts.rotate += 1;
    }
  }

  const roadmapsTouched = new Set(items.filter((i) => i.kind === "step").map((i) => i.roadmapId));
  const why = summarize(items, roadmapsTouched.size, used, budgetMin);

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
function summarize(items, roadmapCount, used, budget) {
  if (items.length === 0) {
    return "Nothing queued — add a task or a roadmap step to get a plan.";
  }
  const isDue = (i) => i.reason === "due" || i.reason === "overdue";
  const dueN = items.filter(isDue).length;
  const stepN = items.filter((i) => i.kind === "step").length;
  const taskN = items.filter((i) => i.kind === "task" && !isDue(i)).length;
  const plural = (n, w) => `${n} ${w}${n > 1 ? "s" : ""}`;

  const parts = [];
  if (dueN) {
    parts.push(plural(dueN, "due item"));
  }
  if (stepN) {
    parts.push(
      plural(stepN, "step") + (roadmapCount > 1 ? ` across ${roadmapCount} roadmaps` : ""),
    );
  }
  if (taskN) {
    parts.push(plural(taskN, "task"));
  }
  const head = parts.join(" + ") || plural(items.length, "item");
  const time = used > budget ? `~${used} min (over your ${budget})` : `~${used} of ${budget} min`;
  return `${head} — ${time}.`;
}
