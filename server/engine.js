// engine.js — Michi's brain. Two pure functions over the full state:
//   buildToday(state, opts)  → the focused daily queue ("what should I do today?")
//   momentum(state, opts)    → streak / heatmap / progress summary
// Pure and side-effect free so they're trivial to unit-test and safe to call often.

/** Local YYYY-MM-DD for a Date (server-local; the client may pass its own day). */
export function dayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Day-of-week 0..6 (Sun..Sat) for a YYYY-MM-DD string, in a tz-stable way. */
function dow(dayStr) {
  // append midday UTC so DST / tz never shifts the calendar day
  return new Date(`${dayStr}T12:00:00Z`).getUTCDay();
}

/** Step → minimal shape the client renders in the queue. */
function stepLine(step, milestone, roadmap) {
  return {
    kind: "step",
    id: step.id,
    title: step.title,
    status: step.status,
    resourceUrl: step.resourceUrl || null,
    roadmapId: roadmap?.id || null,
    roadmapTitle: roadmap?.title || null,
    roadmapColor: roadmap?.color || null,
    milestoneTitle: milestone?.title || null,
  };
}

/** Task → minimal shape the client renders in the queue. */
function taskLine(task) {
  return {
    kind: "task",
    id: task.id,
    title: task.title,
    status: task.status,
    due: task.due || null,
    recurrence: task.recurrence || null,
    estMin: task.estMin ?? null,
    stepId: task.stepId || null,
    projectId: task.projectId || null,
  };
}

/**
 * Is a recurring task "due" on `today`?  daily → always; weekdays → Mon–Fri;
 * weekly → same weekday as its anchor `due` (or any day if no anchor set).
 */
function recurringDueToday(task, today) {
  if (task.recurrence === "daily") {
    return true;
  }
  if (task.recurrence === "weekdays") {
    const d = dow(today);
    return d >= 1 && d <= 5;
  }
  if (task.recurrence === "weekly") {
    return !task.due || dow(task.due) === dow(today);
  }
  return false;
}

/** Was a (possibly recurring) task already completed on `today`? */
function doneToday(task, today) {
  return task.status === "done" && (task.doneAt || "").slice(0, 10) === today;
}

/**
 * Build the focused daily queue.
 * @param {Object} state full model from db.getState()
 * @param {Object} [opts]
 * @param {string} [opts.today] YYYY-MM-DD (defaults to server-local today)
 * @param {number} [opts.limit] cap on suggested next-steps (default 5)
 */
export function buildToday(state, { today = dayKey(), limit = 5 } = {}) {
  const tasks = state.tasks || [];
  const roadmaps = state.roadmaps || [];
  const milestones = state.milestones || [];
  const steps = state.steps || [];

  // ── tasks: overdue, due today, recurring-due ──────────────────────────────
  const overdue = [];
  const dueToday = [];
  const doneTodayList = [];

  for (const t of tasks) {
    if (doneToday(t, today)) {
      doneTodayList.push(taskLine(t));
      continue;
    }
    if (t.status === "done" && !t.recurrence) {
      continue; // finished one-off — not on the queue
    }
    const isRecurringDue = t.recurrence && recurringDueToday(t, today);
    if (t.due && t.due < today) {
      overdue.push(taskLine(t));
    } else if (t.due === today || isRecurringDue || (!t.due && !t.recurrence)) {
      // explicit today, a recurring hit, or a loose backlog task with no date
      dueToday.push(taskLine(t));
    }
  }

  // ── next steps: the first not-done step of each active (non-archived) roadmap ──
  const suggested = [];
  for (const r of roadmaps.filter((r) => !r.archived)) {
    const rMilestones = milestones
      .filter((m) => m.roadmapId === r.id)
      .sort((a, b) => a.position - b.position);
    let picked = null;
    for (const m of rMilestones) {
      const next = steps
        .filter((s) => s.milestoneId === m.id && s.status !== "done")
        .sort((a, b) => a.position - b.position)[0];
      if (next) {
        picked = stepLine(next, m, r);
        break;
      }
    }
    if (picked) {
      suggested.push(picked);
    }
  }
  // steps already "doing" float to the top of suggestions
  suggested.sort((a, b) => (a.status === "doing" ? -1 : 0) - (b.status === "doing" ? -1 : 0));

  const focus = [...overdue, ...dueToday, ...suggested.slice(0, limit)];

  return {
    day: today,
    overdue,
    dueToday,
    suggested: suggested.slice(0, limit),
    doneToday: doneTodayList,
    focus,
    counts: {
      overdue: overdue.length,
      dueToday: dueToday.length,
      suggested: Math.min(suggested.length, limit),
      doneToday: doneTodayList.length,
    },
  };
}

/** Set of YYYY-MM-DD days with ≥1 completion (tasks done_at + steps done_at). */
export function activityByDay(state) {
  const counts = new Map();
  const add = (iso) => {
    if (!iso) {
      return;
    }
    const day = iso.slice(0, 10);
    counts.set(day, (counts.get(day) || 0) + 1);
  };
  for (const t of state.tasks || []) {
    if (t.status === "done") {
      add(t.doneAt);
    }
  }
  for (const s of state.steps || []) {
    if (s.status === "done") {
      add(s.doneAt);
    }
  }
  return counts;
}

/** Step back one calendar day from a YYYY-MM-DD string. */
function prevDay(dayStr) {
  const d = new Date(`${dayStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Compute the current streak ending at/near `today`. Freezes let a limited number
 * of missed days be bridged before the streak breaks. Today not being done yet
 * doesn't break the streak — it just marks it "at risk".
 * @returns {{current:number, atRisk:boolean, freezesUsed:number}}
 */
export function computeStreak(daySet, today, freezes = 0) {
  let cursor = today;
  let current = 0;
  let freezesUsed = 0;
  let atRisk = false;

  // if today isn't done yet, don't count or break on it — start from yesterday
  if (!daySet.has(today)) {
    atRisk = true;
    cursor = prevDay(today);
  }
  for (;;) {
    if (daySet.has(cursor)) {
      current += 1;
      cursor = prevDay(cursor);
    } else if (freezesUsed < freezes) {
      freezesUsed += 1; // bridge the gap with a freeze
      cursor = prevDay(cursor);
    } else {
      break;
    }
  }
  return { current, atRisk, freezesUsed };
}

/** Longest run of consecutive active days anywhere in history (no freezes). */
export function longestStreak(daySet) {
  const days = [...daySet].sort();
  let longest = 0;
  let run = 0;
  let prev = null;
  for (const d of days) {
    run = prev && prevDay(d) === prev ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = d;
  }
  return longest;
}

/** Per-roadmap progress: { id, title, done, total, pct }. */
export function roadmapProgress(state) {
  const steps = state.steps || [];
  const milestones = state.milestones || [];
  const mToRoadmap = new Map(milestones.map((m) => [m.id, m.roadmapId]));
  const byRoadmap = new Map();
  for (const s of steps) {
    const rid = mToRoadmap.get(s.milestoneId);
    if (!rid) {
      continue;
    }
    const acc = byRoadmap.get(rid) || { done: 0, total: 0 };
    acc.total += 1;
    if (s.status === "done") {
      acc.done += 1;
    }
    byRoadmap.set(rid, acc);
  }
  return (state.roadmaps || []).map((r) => {
    const acc = byRoadmap.get(r.id) || { done: 0, total: 0 };
    return {
      id: r.id,
      title: r.title,
      color: r.color || null,
      archived: !!r.archived,
      done: acc.done,
      total: acc.total,
      pct: acc.total ? Math.round((acc.done / acc.total) * 100) : 0,
    };
  });
}

/**
 * Momentum summary: streak, today's progress vs goal, a recent heatmap, totals.
 * @param {Object} state
 * @param {Object} [opts] { today, heatDays=120 }
 */
export function momentum(state, { today = dayKey(), heatDays = 120 } = {}) {
  const settings = state.settings || {};
  const dailyGoal = Number(settings.dailyGoal) || 1;
  const freezes = Number(settings.streakFreezes) || 0;

  const counts = activityByDay(state);
  const todayCount = counts.get(today) || 0;

  const { current, atRisk, freezesUsed } = computeStreak(counts, today, freezes);

  // recent heatmap, oldest → newest, always exactly heatDays long
  const heat = [];
  let cursor = today;
  for (let i = 0; i < heatDays; i++) {
    heat.unshift({ date: cursor, count: counts.get(cursor) || 0 });
    cursor = prevDay(cursor);
  }

  const totalDone = [...counts.values()].reduce((a, b) => a + b, 0);
  const projects = state.projects || [];

  return {
    day: today,
    streak: { current, longest: longestStreak(counts), atRisk, freezesUsed, freezes },
    todayCount,
    dailyGoal,
    metGoal: todayCount >= dailyGoal,
    daysActive: counts.size,
    totalDone,
    roadmaps: roadmapProgress(state),
    projects: {
      idea: projects.filter((p) => p.status === "idea").length,
      active: projects.filter((p) => p.status === "active").length,
      shipped: projects.filter((p) => p.status === "shipped").length,
    },
    heat,
  };
}
