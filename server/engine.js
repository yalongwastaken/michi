// engine.js — Michi's brain. Two functions over the full state:
//   buildToday(state, opts)  → the focused daily queue ("what should I do today?")
//   momentum(state, opts)    → streak / heatmap / XP / progress summary
// Pure and side-effect free so they're trivial to unit-test and safe to call often.
// (One deliberate seam: momentum reads its day-counts through a pluggable source —
// see setActivitySource — so db.js can feed it a cached aggregate instead of the
// raw, unbounded completions log. With nothing registered it stays fully pure.)
// Date math lives in dates.js; the queue line shapes in project.js — both shared
// with the planner/insights/review so the copies can't drift apart.
import { dayKey, dow, localDay, prevDay } from "./dates.js";
import { stepLine, taskLine } from "./project.js";

/**
 * Is a recurring task "due" on `today`?  daily → always; weekdays → Mon–Fri;
 * weekly → same weekday as its anchor `due` (or any day if no anchor set).
 */
export function recurringDueToday(task, today) {
  if (task.recurrence === "daily") {
    return true;
  }
  if (task.recurrence === "weekdays") {
    const d = dow(today);
    return d >= 1 && d <= 5;
  }
  if (task.recurrence === "weekly") {
    // weekly needs an anchor date to know which weekday it repeats on; without
    // one it would match every day (i.e. behave like "daily"), so treat as not-due
    return task.due ? dow(task.due) === dow(today) : false;
  }
  return false;
}

/** Was a (possibly recurring) task already completed on `today`? */
function doneToday(task, today) {
  return task.status === "done" && localDay(task.doneAt) === today;
}

/**
 * Build the focused daily queue.
 * @param {Object} state full model from db.getState()
 * @param {Object} [opts]
 * @param {string} [opts.today] YYYY-MM-DD (defaults to server-local today)
 * @param {number} [opts.limit] cap on suggested next-steps (default 5)
 */
export function buildToday(state, { today = dayKey(), limit = 5 } = {}) {
  // guard direct callers too: a negative limit would slice(0, -1) and silently
  // drop suggestions from the end instead of capping them
  const cap = Number.isFinite(limit) && limit >= 0 ? limit : 5;
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
    if (t.recurrence) {
      // recurring tasks live entirely off their cadence — their `due` is just a
      // weekly anchor, never an "overdue" date. Surface as actionable for today.
      if (recurringDueToday(t, today)) {
        dueToday.push(taskLine(t, { status: "todo" })); // actionable again today
      }
      continue;
    }
    if (t.status === "done") {
      continue; // finished one-off — not on the queue
    }
    if (t.due && t.due < today) {
      overdue.push(taskLine(t));
    } else if (t.due === today || !t.due) {
      // explicit today, or a loose backlog task with no date
      dueToday.push(taskLine(t));
    }
  }

  // ── next steps: the first not-done step of each active (non-archived) roadmap ──
  // bucket milestones/steps once (O(n)) instead of re-scanning per roadmap
  const msByRoadmap = new Map();
  for (const m of milestones) {
    (msByRoadmap.get(m.roadmapId) || msByRoadmap.set(m.roadmapId, []).get(m.roadmapId)).push(m);
  }
  const stepsByMs = new Map();
  for (const s of steps) {
    (stepsByMs.get(s.milestoneId) || stepsByMs.set(s.milestoneId, []).get(s.milestoneId)).push(s);
  }
  const suggested = [];
  for (const r of roadmaps.filter((r) => !r.archived)) {
    const rMilestones = (msByRoadmap.get(r.id) || [])
      .slice()
      .sort((a, b) => a.position - b.position);
    let picked = null;
    for (const m of rMilestones) {
      const next = (stepsByMs.get(m.id) || [])
        .filter((s) => s.status !== "done")
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

  const focus = [...overdue, ...dueToday, ...suggested.slice(0, cap)];

  return {
    day: today,
    overdue,
    dueToday,
    suggested: suggested.slice(0, cap),
    doneToday: doneTodayList,
    focus,
    counts: {
      overdue: overdue.length,
      dueToday: dueToday.length,
      suggested: Math.min(suggested.length, cap),
      doneToday: doneTodayList.length,
    },
  };
}

/**
 * Map of local-day → completion count, read from the append-only completions log.
 * The log already buckets each event by the local day it happened, so recurring
 * habits accumulate real history (one mutable done_at column never could).
 */
export function activityByDay(state) {
  const counts = new Map();
  for (const c of state.completions || []) {
    if (!c?.day) {
      continue;
    }
    counts.set(c.day, (counts.get(c.day) || 0) + 1);
  }
  return counts;
}

/**
 * Aggregate a raw completions log into the summary shape momentum reads:
 * day → {tasks, steps} counts plus lifetime totals. db.getActivitySummary()
 * returns the exact same shape from its incremental cache — this is the pure
 * fallback for when no source is registered (unit tests, plain function calls).
 */
export function summarizeActivity(completions = []) {
  const byDay = new Map();
  const totals = { tasks: 0, steps: 0 };
  for (const c of completions) {
    if (!c?.day) {
      continue;
    }
    const key = c.kind === "step" ? "steps" : "tasks";
    const rec = byDay.get(c.day) || { tasks: 0, steps: 0 };
    rec[key] += 1;
    totals[key] += 1;
    byDay.set(c.day, rec);
  }
  return { byDay, totals };
}

// The pluggable activity source: db.js registers its cached aggregate here at load
// time, so every momentum() call in the running server skips re-walking the whole
// completions log (and simply ignores any raw log riding along in `state`).
let activitySource = null;
export function setActivitySource(fn) {
  activitySource = fn;
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
  let pending = 0; // freezes tentatively spent on a gap, not yet "earned"
  let atRisk = false;

  // if today isn't done yet, don't count or break on it — start from yesterday
  if (!daySet.has(today)) {
    atRisk = true;
    cursor = prevDay(today);
  }
  for (;;) {
    if (daySet.has(cursor)) {
      current += 1;
      freezesUsed += pending; // commit the bridges we crossed to reach this active day
      pending = 0;
      cursor = prevDay(cursor);
    } else if (freezesUsed + pending < freezes) {
      pending += 1; // tentatively bridge the gap; only counts if an active day follows
      cursor = prevDay(cursor);
    } else {
      break;
    }
  }
  // trailing `pending` freezes ran off the end of history → never bridged anything
  return { current, atRisk, freezesUsed };
}

/** Longest run of consecutive active days anywhere in history (no freezes). */
export function longestStreak(daySet) {
  // .keys() yields day strings for both a Set and the Map momentum() passes in
  // (spreading a Map directly would yield [key,value] pairs — a subtle trap)
  const days = [...daySet.keys()].sort();
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

// ── XP: distance walked on your path ──────────────────────────────────────────
// The metaphor: every completion is meters walked. A roadmap step is a bigger
// stride than a one-off task; levels are WAYPOINTS along the trail. Cumulative
// distance for 1-based level n is 100·n·(n+1)/2 m — the triangular ramp makes the
// early waypoints arrive fast and the later ones stretch out.
export const METERS_PER = { step: 25, task: 10 };

const WAYPOINTS = [
  "Trailhead",
  "First Marker",
  "Mossy Steps",
  "Stream Crossing",
  "Bamboo Grove",
  "Stone Lantern",
  "Mountain Gate",
  "Cedar Pass",
  "High Meadow",
  "Cloud Line",
  "Ridge Walk",
  "Summit",
];

/** Streak badge thresholds (days). Judged against the LONGEST streak ever, so a
 * badge once earned stays earned even after the current streak breaks. */
export const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100, 180, 365];

/** Meters earned by {tasks, steps} completion counts. */
export function metersFor({ tasks = 0, steps = 0 } = {}) {
  return tasks * METERS_PER.task + steps * METERS_PER.step;
}

/** Cumulative meters needed to reach 1-based level n (level 0 starts at 0 m). */
export function levelThreshold(n) {
  return (100 * n * (n + 1)) / 2;
}

// tiny roman-numeral formatter for waypoint "laps" past the end of the list —
// twelve names per lap, so even prolific walkers stay at II/III territory
function roman(n) {
  const table = [
    [1000, "M"],
    [900, "CM"],
    [500, "D"],
    [400, "CD"],
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let out = "";
  for (const [v, sym] of table) {
    while (n >= v) {
      out += sym;
      n -= v;
    }
  }
  return out;
}

/** Waypoint name for a level; past the list it cycles with a lap numeral, so
 * level 12 is "Trailhead II" and level 23 "Summit II". Level 0 = "Trailhead". */
export function waypointName(level) {
  const name = WAYPOINTS[level % WAYPOINTS.length];
  const lap = Math.floor(level / WAYPOINTS.length);
  return lap ? `${name} ${roman(lap + 1)}` : name;
}

/**
 * The full xp block for the momentum payload, from lifetime + today's counts.
 * @param {{tasks:number, steps:number}} totals lifetime completion counts
 * @param {{tasks:number, steps:number}} [todayCounts] today's completion counts
 */
export function xpSummary(totals, todayCounts) {
  const totalM = metersFor(totals);
  let level = 0;
  while (levelThreshold(level + 1) <= totalM) {
    level += 1;
  }
  const levelStartM = levelThreshold(level);
  const nextLevelM = levelThreshold(level + 1);
  return {
    level,
    name: waypointName(level),
    totalM,
    levelStartM,
    nextLevelM,
    progressPct: Math.round(((totalM - levelStartM) / (nextLevelM - levelStartM)) * 100),
    todayM: metersFor(todayCounts || {}),
  };
}

/** Streak badges as {days, earned} pairs, judged against the longest streak ever. */
export function streakMilestones(longest) {
  return STREAK_MILESTONES.map((days) => ({ days, earned: longest >= days }));
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
 * Momentum summary: streak, today's progress vs goal, a recent heatmap, XP, totals.
 * @param {Object} state
 * @param {Object} [opts] { today, heatDays=120 }
 */
export function momentum(state, { today = dayKey(), heatDays = 120 } = {}) {
  const settings = state.settings || {};
  // 0 is a valid "rest mode" goal — only fall back to 1 when missing/invalid
  const rawGoal = Number(settings.dailyGoal);
  const dailyGoal = Number.isFinite(rawGoal) && rawGoal >= 0 ? rawGoal : 1;
  // clamp: an Infinity/huge freeze count would make computeStreak walk back
  // day-by-day (nearly) forever and wedge the event loop
  const freezes = Math.min(Math.max(Number(settings.streakFreezes) || 0, 0), 365);

  // the registered cache when db.js is loaded (the running server — any raw log in
  // `state` is ignored there), the pure raw-log walk otherwise (unit tests)
  const { byDay, totals } = activitySource
    ? activitySource()
    : summarizeActivity(state.completions);
  const countOn = (day) => {
    const rec = byDay.get(day);
    return rec ? rec.tasks + rec.steps : 0;
  };
  const todayCount = countOn(today);

  const { current, atRisk, freezesUsed } = computeStreak(byDay, today, freezes);
  const longest = longestStreak(byDay);

  // recent heatmap, oldest → newest, always exactly heatDays long
  const heat = [];
  let cursor = today;
  for (let i = 0; i < heatDays; i++) {
    heat.unshift({ date: cursor, count: countOn(cursor) });
    cursor = prevDay(cursor);
  }

  const totalDone = totals.tasks + totals.steps;
  const projects = state.projects || [];

  return {
    day: today,
    streak: { current, longest, atRisk, freezesUsed, freezes },
    todayCount,
    dailyGoal,
    metGoal: todayCount >= dailyGoal,
    daysActive: byDay.size,
    totalDone,
    xp: xpSummary(totals, byDay.get(today)),
    milestones: streakMilestones(longest),
    roadmaps: roadmapProgress(state),
    projects: {
      idea: projects.filter((p) => p.status === "idea").length,
      active: projects.filter((p) => p.status === "active").length,
      shipped: projects.filter((p) => p.status === "shipped").length,
    },
    heat,
  };
}
