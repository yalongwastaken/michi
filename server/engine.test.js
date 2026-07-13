// engine.test.js — unit tests for the Today queue + momentum/streak math.
// Run with: node --experimental-sqlite --test  (see package.json "test").
// Pin the timezone so day-bucketing of ISO timestamps is deterministic wherever
// `make test` runs (the engine buckets done_at by the *local* day on purpose).
process.env.TZ = "UTC";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildToday,
  momentum,
  computeStreak,
  longestStreak,
  roadmapProgress,
  activityByDay,
  summarizeActivity,
  metersFor,
  levelThreshold,
  waypointName,
  xpSummary,
  streakMilestones,
} from "./engine.js";

// minimal state factory
function state(over = {}) {
  return {
    roadmaps: [],
    milestones: [],
    steps: [],
    projects: [],
    tasks: [],
    completions: [],
    settings: { dailyGoal: 3, streakFreezes: 2 },
    ...over,
  };
}

// completion-log row helper
function done(day, kind = "task", refId = "x") {
  return { id: `${kind}_${refId}_${day}`, day, kind, refId, ts: `${day}T12:00:00Z` };
}

test("buildToday: overdue, due-today and undated tasks all surface", () => {
  const s = state({
    tasks: [
      { id: "a", title: "overdue", status: "todo", due: "2026-06-20" },
      { id: "b", title: "today", status: "todo", due: "2026-06-23" },
      { id: "c", title: "backlog", status: "todo" },
      { id: "d", title: "future", status: "todo", due: "2026-06-30" },
    ],
  });
  const t = buildToday(s, { today: "2026-06-23" });
  assert.equal(t.overdue.length, 1);
  assert.equal(t.overdue[0].id, "a");
  assert.deepEqual(t.dueToday.map((x) => x.id).sort(), ["b", "c"]);
  // the future-dated task is not in focus
  assert.ok(!t.focus.find((x) => x.id === "d"));
});

test("buildToday: a task done today moves to doneToday, not the queue", () => {
  const s = state({
    tasks: [{ id: "a", title: "done", status: "done", doneAt: "2026-06-23T09:00:00Z" }],
  });
  const t = buildToday(s, { today: "2026-06-23" });
  assert.equal(t.doneToday.length, 1);
  assert.equal(t.dueToday.length, 0);
  assert.equal(t.overdue.length, 0);
});

test("buildToday: daily recurring task recurs even when previously done", () => {
  const s = state({
    tasks: [
      // completed yesterday, recurring daily → should be due again today
      {
        id: "r",
        title: "read",
        status: "done",
        recurrence: "daily",
        doneAt: "2026-06-22T09:00:00Z",
      },
    ],
  });
  const t = buildToday(s, { today: "2026-06-23" });
  assert.equal(t.dueToday.length, 1);
  assert.equal(t.dueToday[0].id, "r");
});

test("buildToday: weekdays recurrence skips weekends", () => {
  const s = state({
    tasks: [{ id: "w", title: "standup", status: "todo", recurrence: "weekdays" }],
  });
  // 2026-06-20 is a Saturday, 2026-06-22 a Monday
  assert.equal(buildToday(s, { today: "2026-06-20" }).dueToday.length, 0);
  assert.equal(buildToday(s, { today: "2026-06-22" }).dueToday.length, 1);
});

test("buildToday: suggests the first not-done step per active roadmap", () => {
  const s = state({
    roadmaps: [
      { id: "rm", title: "Embedded", archived: false },
      { id: "arch", title: "Old", archived: true },
    ],
    milestones: [
      { id: "m1", roadmapId: "rm", title: "Basics", position: 0 },
      { id: "m2", roadmapId: "arch", title: "X", position: 0 },
    ],
    steps: [
      { id: "s1", milestoneId: "m1", title: "GPIO", status: "done", position: 0 },
      { id: "s2", milestoneId: "m1", title: "UART", status: "todo", position: 1 },
      { id: "s3", milestoneId: "m1", title: "SPI", status: "todo", position: 2 },
      { id: "s4", milestoneId: "m2", title: "archived step", status: "todo", position: 0 },
    ],
  });
  const t = buildToday(s, { today: "2026-06-23" });
  assert.equal(t.suggested.length, 1); // archived roadmap excluded
  assert.equal(t.suggested[0].id, "s2"); // first not-done by position
  assert.equal(t.suggested[0].roadmapTitle, "Embedded");
});

test("buildToday: a negative limit falls back to the default instead of slicing", () => {
  const s = state({
    roadmaps: [{ id: "rm", title: "Embedded", archived: false }],
    milestones: [{ id: "m1", roadmapId: "rm", title: "Basics", position: 0 }],
    steps: [{ id: "s1", milestoneId: "m1", title: "GPIO", status: "todo", position: 0 }],
  });
  const t = buildToday(s, { today: "2026-06-23", limit: -1 });
  assert.equal(t.suggested.length, 1); // slice(0, -1) would have dropped it
  assert.equal(t.counts.suggested, 1);
});

test("computeStreak: counts consecutive days ending today", () => {
  const days = new Set(["2026-06-21", "2026-06-22", "2026-06-23"]);
  const r = computeStreak(days, "2026-06-23", 0);
  assert.equal(r.current, 3);
  assert.equal(r.atRisk, false);
});

test("computeStreak: today not done yet keeps streak but flags atRisk", () => {
  const days = new Set(["2026-06-21", "2026-06-22"]);
  const r = computeStreak(days, "2026-06-23", 0);
  assert.equal(r.current, 2);
  assert.equal(r.atRisk, true);
});

test("computeStreak: freezes bridge a missed day", () => {
  const days = new Set(["2026-06-20", "2026-06-22", "2026-06-23"]); // missing the 21st
  const noFreeze = computeStreak(days, "2026-06-23", 0);
  assert.equal(noFreeze.current, 2); // breaks at the gap
  const withFreeze = computeStreak(days, "2026-06-23", 1);
  assert.equal(withFreeze.current, 3); // freeze bridges the 21st
  assert.equal(withFreeze.freezesUsed, 1);
});

test("computeStreak: trailing gaps off the end of history don't spend freezes", () => {
  // a brand-new 1-day streak shouldn't report freezes used (regression guard)
  const r = computeStreak(new Set(["2026-06-23"]), "2026-06-23", 2);
  assert.equal(r.current, 1);
  assert.equal(r.freezesUsed, 0);
});

test("longestStreak: finds the longest historical run", () => {
  const days = new Set(["2026-01-01", "2026-01-02", "2026-01-03", "2026-02-01", "2026-02-02"]);
  assert.equal(longestStreak(days), 3);
});

test("activityByDay: counts completion-log events per day", () => {
  const s = state({
    completions: [done("2026-06-23", "task", "t"), done("2026-06-23", "step", "s")],
  });
  const counts = activityByDay(s);
  assert.equal(counts.get("2026-06-23"), 2);
});

test("activityByDay: a daily habit completed across days accumulates history", () => {
  // regression guard for the single-done_at overwrite bug
  const s = state({
    tasks: [{ id: "h", title: "Read", recurrence: "daily", status: "done" }],
    completions: [
      done("2026-06-21", "task", "h"),
      done("2026-06-22", "task", "h"),
      done("2026-06-23", "task", "h"),
    ],
  });
  const m = momentum(s, { today: "2026-06-23" });
  assert.equal(m.daysActive, 3);
  assert.equal(m.streak.current, 3);
});

test("roadmapProgress: percentage per roadmap", () => {
  const s = state({
    roadmaps: [{ id: "rm", title: "Embedded" }],
    milestones: [{ id: "m1", roadmapId: "rm", title: "Basics" }],
    steps: [
      { id: "s1", milestoneId: "m1", status: "done" },
      { id: "s2", milestoneId: "m1", status: "todo" },
      { id: "s3", milestoneId: "m1", status: "todo" },
      { id: "s4", milestoneId: "m1", status: "done" },
    ],
  });
  const p = roadmapProgress(s);
  assert.equal(p[0].done, 2);
  assert.equal(p[0].total, 4);
  assert.equal(p[0].pct, 50);
});

test("momentum: pathological streakFreezes are clamped, never walked day-by-day", () => {
  // "Infinity"/1e9 used to reach computeStreak untouched — which steps back one
  // calendar day per freeze and would wedge the event loop. Assert the clamp
  // instead of actually spinning the loop.
  const s = state({
    completions: [done("2026-06-23")],
    settings: { dailyGoal: 3, streakFreezes: "Infinity" },
  });
  const m = momentum(s, { today: "2026-06-23" });
  assert.equal(m.streak.freezes, 365);
  assert.equal(m.streak.current, 1);
  const big = momentum(state({ settings: { dailyGoal: 3, streakFreezes: 1e9 } }), {
    today: "2026-06-23",
  });
  assert.equal(big.streak.freezes, 365);
  const neg = momentum(state({ settings: { dailyGoal: 3, streakFreezes: -4 } }), {
    today: "2026-06-23",
  });
  assert.equal(neg.streak.freezes, 0);
});

test("momentum: dailyGoal 0 is a valid rest goal, not coerced to 1", () => {
  const m = momentum(state({ settings: { dailyGoal: 0, streakFreezes: 0 } }), {
    today: "2026-06-23",
  });
  assert.equal(m.dailyGoal, 0);
  assert.equal(m.metGoal, true); // nothing done, but the goal is zero
  // missing/invalid still falls back to 1
  const bad = momentum(state({ settings: { dailyGoal: "??", streakFreezes: 0 } }), {
    today: "2026-06-23",
  });
  assert.equal(bad.dailyGoal, 1);
});

test("summarizeActivity: per-day per-kind counts plus lifetime totals", () => {
  const { byDay, totals } = summarizeActivity([
    done("2026-06-22", "step", "s"),
    done("2026-06-23", "task", "t"),
    done("2026-06-23", "step", "s"),
  ]);
  assert.deepEqual(byDay.get("2026-06-22"), { tasks: 0, steps: 1 });
  assert.deepEqual(byDay.get("2026-06-23"), { tasks: 1, steps: 1 });
  assert.deepEqual(totals, { tasks: 1, steps: 2 });
});

test("xp: a step is 25 m, a task 10 m, summed over the whole log", () => {
  assert.equal(metersFor({ tasks: 2, steps: 1 }), 45);
  assert.equal(metersFor({}), 0);
  const s = state({
    completions: [
      done("2026-06-22", "step", "s1"),
      done("2026-06-23", "task", "a"),
      done("2026-06-23", "task", "b"),
    ],
  });
  const m = momentum(s, { today: "2026-06-23" });
  assert.equal(m.xp.totalM, 45);
  assert.equal(m.xp.todayM, 20); // only today's two tasks, not yesterday's step
});

test("xp: waypoint thresholds are triangular — early levels come fast", () => {
  assert.equal(levelThreshold(1), 100);
  assert.equal(levelThreshold(2), 300);
  assert.equal(levelThreshold(3), 600);
  // 90 m: still walking toward the first waypoint
  const walking = xpSummary({ tasks: 9, steps: 0 });
  assert.equal(walking.level, 0);
  assert.equal(walking.name, "Trailhead");
  assert.equal(walking.levelStartM, 0);
  assert.equal(walking.nextLevelM, 100);
  assert.equal(walking.progressPct, 90);
  // exactly 100 m: waypoint reached, progress resets toward the next
  const reached = xpSummary({ tasks: 10, steps: 0 });
  assert.equal(reached.level, 1);
  assert.equal(reached.name, "First Marker");
  assert.equal(reached.levelStartM, 100);
  assert.equal(reached.nextLevelM, 300);
  assert.equal(reached.progressPct, 0);
});

test("xp: no completions at all = level 0, at the Trailhead", () => {
  const m = momentum(state(), { today: "2026-06-23" });
  assert.deepEqual(m.xp, {
    level: 0,
    name: "Trailhead",
    totalM: 0,
    levelStartM: 0,
    nextLevelM: 100,
    progressPct: 0,
    todayM: 0,
  });
});

test("xp: waypoint names cycle with a lap numeral past the end of the list", () => {
  assert.equal(waypointName(0), "Trailhead");
  assert.equal(waypointName(11), "Summit");
  assert.equal(waypointName(12), "Trailhead II"); // second lap of the trail
  assert.equal(waypointName(23), "Summit II");
  assert.equal(waypointName(35), "Summit III");
});

test("milestones: streak badges judge the longest streak ever, so they stay earned", () => {
  assert.deepEqual(
    streakMilestones(0).map((b) => b.earned),
    [false, false, false, false, false, false, false, false],
  );
  // a 3-day run long ago, then nothing — the current streak is dead but the
  // 3-day badge survives
  const s = state({
    completions: [done("2026-05-01"), done("2026-05-02"), done("2026-05-03")],
    settings: { dailyGoal: 3, streakFreezes: 0 },
  });
  const m = momentum(s, { today: "2026-06-23" });
  assert.equal(m.streak.current, 0);
  assert.equal(m.streak.longest, 3);
  assert.deepEqual(
    m.milestones.map((b) => b.days),
    [3, 7, 14, 30, 60, 100, 180, 365],
  );
  assert.deepEqual(
    m.milestones.filter((b) => b.earned).map((b) => b.days),
    [3],
  );
});

test("momentum: heatmap is exactly heatDays long and ends today", () => {
  const s = state({ completions: [done("2026-06-23", "task", "t")] });
  const m = momentum(s, { today: "2026-06-23", heatDays: 30 });
  assert.equal(m.heat.length, 30);
  assert.equal(m.heat[m.heat.length - 1].date, "2026-06-23");
  assert.equal(m.heat[m.heat.length - 1].count, 1);
  assert.equal(m.todayCount, 1);
  assert.equal(m.metGoal, false); // goal is 3
});
