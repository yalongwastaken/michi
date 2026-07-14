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
 * day → {tasks, steps, kata} counts plus lifetime totals. db.getActivitySummary()
 * returns the exact same shape from its incremental cache — this is the pure
 * fallback for when no source is registered (unit tests, plain function calls).
 */
export function summarizeActivity(completions = []) {
  const byDay = new Map();
  const totals = { tasks: 0, steps: 0, kata: 0 };
  for (const c of completions) {
    if (!c?.day) {
      continue;
    }
    const key = c.kind === "step" ? "steps" : c.kind === "kata" ? "kata" : "tasks";
    const rec = byDay.get(c.day) || { tasks: 0, steps: 0, kata: 0 };
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

// ── kata: daily forms and the clean-day math ──────────────────────────────────
// A kata_days row is the honor ledger for one local day: active_ids is a snapshot
// of the active set taken at the FIRST honor of the day, honored_ids grows/shrinks
// with the toggle. A day is "clean" when the snapshot was honored in full — the
// snapshot wins over later edits to the active set, so adding a sixth form at
// 11 pm can't retroactively dirty a day you already completed.

/** Was this kata_days row a clean day? (null/absent row → false) */
export function isClean(row) {
  const active = row?.activeIds;
  const honored = row?.honoredIds;
  if (!Array.isArray(active) || !Array.isArray(honored) || active.length === 0) {
    return false;
  }
  const h = new Set(honored);
  return active.every((id) => h.has(id));
}

/**
 * Consecutive clean days ending today-or-yesterday. Same grace as computeStreak —
 * today not being clean YET doesn't break the run, it just doesn't count — but
 * streak freezes deliberately do NOT apply: a kata is honored daily or it isn't.
 */
export function computeCleanStreak(cleanSet, today) {
  let cursor = cleanSet.has(today) ? today : prevDay(today);
  let n = 0;
  while (cleanSet.has(cursor)) {
    n += 1;
    cursor = prevDay(cursor);
  }
  return n;
}

// ── discipline grades: the kyū/dan ladder over cumulative clean days ──────────
// Triangular kyū ramp (1, 3, 6, … 55 clean days for 10級→1級), then the dan ranks
// stretch out. Cumulative and lifetime — a broken streak never demotes you.
const KYU_AT = [1, 3, 6, 10, 15, 21, 28, 36, 45, 55];
const KYU_ORD = ["10th", "9th", "8th", "7th", "6th", "5th", "4th", "3rd", "2nd", "1st"];
const KYU_WORD = [
  "tenth",
  "ninth",
  "eighth",
  "seventh",
  "sixth",
  "fifth",
  "fourth",
  "third",
  "second",
  "first",
];
const DAN = [
  ["初段", "shodan", "first dan", 70],
  ["二段", "nidan", "second dan", 90],
  ["三段", "sandan", "third dan", 115],
  ["四段", "yondan", "fourth dan", 145],
  ["五段", "godan", "fifth dan", 180],
  ["六段", "rokudan", "sixth dan", 220],
  ["七段", "nanadan", "seventh dan", 265],
  ["八段", "hachidan", "eighth dan", 315],
  ["九段", "kudan", "ninth dan", 370],
  ["十段", "jūdan", "the path continues", 430], // the cap — there is no "next"
];
export const GRADE_LADDER = [
  { n: 0, label: "無級", romaji: "mukyū", english: "ungraded", at: 0 },
  ...KYU_AT.map((at, i) => ({
    n: 10 - i,
    label: `${10 - i}級`,
    romaji: `${KYU_ORD[i]} kyū`,
    english: `${KYU_WORD[i]} grade`,
    at,
  })),
  ...DAN.map(([label, romaji, english, at], i) => ({ n: i + 1, label, romaji, english, at })),
];

/**
 * The discipline grade for a cumulative clean-day count.
 * @returns {{n, label, romaji, english, cleanDays, next: {label, at, toGo}|null, pct}}
 */
export function grade(cleanDays) {
  const days = Number.isFinite(cleanDays) && cleanDays > 0 ? Math.floor(cleanDays) : 0;
  let idx = 0;
  while (idx + 1 < GRADE_LADDER.length && days >= GRADE_LADDER[idx + 1].at) {
    idx += 1;
  }
  const cur = GRADE_LADDER[idx];
  const next = GRADE_LADDER[idx + 1] || null;
  return {
    n: cur.n,
    label: cur.label,
    romaji: cur.romaji,
    english: cur.english,
    cleanDays: days,
    next: next ? { label: next.label, at: next.at, toGo: next.at - days } : null,
    pct: next ? Math.round(((days - cur.at) / (next.at - cur.at)) * 100) : 100,
  };
}

// ── XP: distance walked on your path ──────────────────────────────────────────
// The metaphor: every completion is meters walked. A roadmap step is a bigger
// stride than a one-off task, a kata honor a small deliberate pace; levels are
// WAYPOINTS along the trail. Cumulative distance for 1-based level n is
// 100·n·(n+1)/2 m — the triangular ramp makes the early waypoints arrive fast
// and the later ones stretch out.
export const METERS_PER = { step: 25, task: 10, kata: 5 };
export const CLEAN_DAY_METERS = 15; // bonus for honoring every active kata in a day

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

/** Meters earned by {tasks, steps, kata} completion counts. */
export function metersFor({ tasks = 0, steps = 0, kata = 0 } = {}) {
  return tasks * METERS_PER.task + steps * METERS_PER.step + kata * METERS_PER.kata;
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
 * Kata completions ride along in the counts (5 m each), and every clean day —
 * all active kata honored — earns a CLEAN_DAY_METERS bonus on top.
 * @param {{tasks:number, steps:number, kata:number}} totals lifetime counts
 * @param {{tasks:number, steps:number, kata:number}} [todayCounts] today's counts
 * @param {{cleanDays:number, todayClean:boolean}} [kataBonus] clean-day bonuses
 */
export function xpSummary(totals, todayCounts, { cleanDays = 0, todayClean = false } = {}) {
  const totalM = metersFor(totals) + cleanDays * CLEAN_DAY_METERS;
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
    todayM: metersFor(todayCounts || {}) + (todayClean ? CLEAN_DAY_METERS : 0),
  };
}

/** Streak badges as {days, earned} pairs, judged against the longest streak ever. */
export function streakMilestones(longest) {
  return STREAK_MILESTONES.map((days) => ({ days, earned: longest >= days }));
}

/**
 * Bonus streak freezes earned by waypoint progression — one at waypoint 4,
 * another at 8, capped at +2. Stateless on purpose: derived from the level every
 * time, never stored, so it can't drift and needs no migration. The streak walk
 * budgets settings.streakFreezes + this (see momentum).
 */
export function earnedFreezes(level) {
  return Math.min(2, Math.floor(level / 4));
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
  const baseFreezes = Math.min(Math.max(Number(settings.streakFreezes) || 0, 0), 365);

  // the registered cache when db.js is loaded (the running server — any raw log in
  // `state` is ignored there), the pure raw-log walk otherwise (unit tests)
  const { byDay, totals } = activitySource
    ? activitySource()
    : summarizeActivity(state.completions);
  // THE kata invariant, split deliberately: the daily goal and the streak count
  // only real work (tasks + steps) — five checkbox honors must never "meet the
  // goal" or carry a streak — while the heatmap and XP count showing up, kata
  // included. Discipline has its own ladder below, fed by clean days alone.
  const workOn = (day) => {
    const rec = byDay.get(day);
    return rec ? rec.tasks + rec.steps : 0;
  };
  const heatOn = (day) => {
    const rec = byDay.get(day);
    return rec ? rec.tasks + rec.steps + (rec.kata || 0) : 0;
  };
  const todayCount = workOn(today);

  // kata clean days (for XP bonuses + the discipline block); kata_days rides in
  // `state` — it's tiny (one row per honored day), unlike the completions log
  const kataDays = state.kataDays || [];
  const rowsByDay = new Map(kataDays.map((r) => [r.day, r]));
  const cleanSet = new Set(kataDays.filter(isClean).map((r) => r.day));

  // the streak's freeze budget = configured base + waypoint earn-back (xp first:
  // the earned count derives from the level)
  const xp = xpSummary(totals, byDay.get(today), {
    cleanDays: cleanSet.size,
    todayClean: cleanSet.has(today),
  });
  const earned = earnedFreezes(xp.level);
  const freezes = baseFreezes + earned;

  // streak walks only the days with real work on them — kata-only days don't count
  const workDays = new Set();
  for (const [day, rec] of byDay) {
    if (rec.tasks + rec.steps > 0) {
      workDays.add(day);
    }
  }
  const { current, atRisk, freezesUsed } = computeStreak(workDays, today, freezes);
  const longest = longestStreak(workDays);

  // the last 7 days of kata practice, oldest → newest, ending today
  const week = [];
  {
    let cursor = today;
    for (let i = 0; i < 7; i++) {
      const row = rowsByDay.get(cursor);
      let state_;
      if (isClean(row)) {
        state_ = "clean";
      } else if (cursor === today) {
        state_ = "pending"; // today isn't over — not dirty, just not done
      } else if (row && (row.honoredIds || []).length > 0) {
        state_ = "partial";
      } else {
        state_ = "none";
      }
      week.unshift({ day: cursor, state: state_ });
      cursor = prevDay(cursor);
    }
  }

  // recent heatmap, oldest → newest, always exactly heatDays long — kata count
  // here (the heatmap celebrates showing up), unlike the goal/streak above
  const heat = [];
  let cursor = today;
  for (let i = 0; i < heatDays; i++) {
    heat.unshift({ date: cursor, count: heatOn(cursor) });
    cursor = prevDay(cursor);
  }

  const totalDone = totals.tasks + totals.steps;
  const projects = state.projects || [];

  return {
    day: today,
    // streak.freezes stays the TOTAL budget — the client renders "X of Y left"
    // from freezes/freezesUsed and must keep working; the block below breaks the
    // total down for UIs that want to celebrate the earn-back
    streak: { current, longest, atRisk, freezesUsed, freezes },
    freezes: {
      base: baseFreezes,
      earned,
      total: freezes,
      used: freezesUsed,
      left: freezes - freezesUsed,
    },
    todayCount,
    dailyGoal,
    metGoal: todayCount >= dailyGoal,
    daysActive: byDay.size,
    totalDone,
    xp,
    discipline: {
      cleanDays: cleanSet.size,
      cleanStreak: computeCleanStreak(cleanSet, today),
      grade: grade(cleanSet.size),
      week,
    },
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
