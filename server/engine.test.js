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
  earnedFreezes,
  isClean,
  computeCleanStreak,
  grade,
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
    done("2026-06-23", "kata", "k"),
  ]);
  assert.deepEqual(byDay.get("2026-06-22"), { tasks: 0, steps: 1, kata: 0 });
  assert.deepEqual(byDay.get("2026-06-23"), { tasks: 1, steps: 1, kata: 1 });
  assert.deepEqual(totals, { tasks: 1, steps: 2, kata: 1 });
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

test("earnedFreezes: a bonus at waypoint 4 and another at 8, capped at +2", () => {
  assert.equal(earnedFreezes(0), 0);
  assert.equal(earnedFreezes(3), 0);
  assert.equal(earnedFreezes(4), 1); // first bonus
  assert.equal(earnedFreezes(7), 1);
  assert.equal(earnedFreezes(8), 2); // second bonus
  assert.equal(earnedFreezes(11), 2);
  assert.equal(earnedFreezes(100), 2); // capped — never more than +2
});

test("momentum: an earned freeze extends the budget and saves a streak", () => {
  // 50 steps long ago → 1250 m → level 4 (threshold 1000) → 1 earned freeze;
  // the configured base is ZERO, so only the earn-back can bridge the gap
  const grind = Array.from({ length: 50 }, (_, i) => done("2026-06-01", "step", `s${i}`));
  const recent = [done("2026-06-20"), done("2026-06-22"), done("2026-06-23")]; // gap on the 21st
  const m = momentum(
    state({ completions: [...grind, ...recent], settings: { dailyGoal: 3, streakFreezes: 0 } }),
    { today: "2026-06-23" },
  );
  assert.equal(m.xp.level, 4);
  assert.deepEqual(m.freezes, { base: 0, earned: 1, total: 1, used: 1, left: 0 });
  assert.equal(m.streak.freezes, 1); // the field the client renders = the TOTAL budget
  assert.equal(m.streak.freezesUsed, 1);
  assert.equal(m.streak.current, 3); // 23rd + 22nd + [bridged 21st] + 20th
  // control: the same recent days without the grind (level 0, nothing earned)
  const control = momentum(
    state({ completions: recent, settings: { dailyGoal: 3, streakFreezes: 0 } }),
    { today: "2026-06-23" },
  );
  assert.deepEqual(control.freezes, { base: 0, earned: 0, total: 0, used: 0, left: 0 });
  assert.equal(control.streak.current, 2); // breaks at the 21st
});

test("momentum: the freeze breakdown adds up (base + earned = total)", () => {
  const m = momentum(state({ completions: [done("2026-06-23")] }), { today: "2026-06-23" });
  assert.deepEqual(m.freezes, { base: 2, earned: 0, total: 2, used: 0, left: 2 });
  assert.equal(m.streak.freezes, m.freezes.total);
});

// ── kata: clean days, the discipline ladder, and the invariant split ────────────

test("isClean: full snapshot honored = clean; empty/absent/partial = not", () => {
  assert.equal(isClean({ activeIds: ["a", "b"], honoredIds: ["b", "a"] }), true);
  assert.equal(isClean({ activeIds: ["a", "b"], honoredIds: ["a"] }), false);
  assert.equal(isClean({ activeIds: [], honoredIds: [] }), false); // no forms ≠ clean
  assert.equal(isClean(null), false);
  assert.equal(isClean(undefined), false);
  // extra honors beyond the snapshot (set shrank mid-day) don't hurt
  assert.equal(isClean({ activeIds: ["a"], honoredIds: ["a", "zombie"] }), true);
});

test("computeCleanStreak: today pending doesn't break the run — freezes never apply", () => {
  const clean = new Set(["2026-06-21", "2026-06-22", "2026-06-23"]);
  assert.equal(computeCleanStreak(clean, "2026-06-23"), 3);
  // today not clean yet → the run ending yesterday still counts (grace)
  assert.equal(computeCleanStreak(new Set(["2026-06-21", "2026-06-22"]), "2026-06-23"), 2);
  // a real gap (the 22nd) breaks it — there is no freeze to bridge kata
  assert.equal(computeCleanStreak(new Set(["2026-06-21", "2026-06-23"]), "2026-06-23"), 1);
  assert.equal(computeCleanStreak(new Set(["2026-06-20", "2026-06-21"]), "2026-06-23"), 0);
  assert.equal(computeCleanStreak(new Set(), "2026-06-23"), 0);
});

test("grade: the kyū/dan ladder edges", () => {
  const g0 = grade(0);
  assert.deepEqual(g0, {
    n: 0,
    label: "無級",
    romaji: "mukyū",
    english: "ungraded",
    cleanDays: 0,
    next: { label: "10級", at: 1, toGo: 1 },
    pct: 0,
  });
  const g1 = grade(1);
  assert.equal(g1.label, "10級");
  assert.equal(g1.romaji, "10th kyū");
  assert.equal(g1.english, "tenth grade");
  assert.deepEqual(g1.next, { label: "9級", at: 3, toGo: 2 });
  const g7 = grade(10);
  assert.equal(g7.label, "7級");
  assert.equal(g7.romaji, "7th kyū");
  assert.equal(g7.english, "seventh grade");
  const g55 = grade(55);
  assert.equal(g55.label, "1級");
  assert.equal(g55.romaji, "1st kyū");
  assert.deepEqual(g55.next, { label: "初段", at: 70, toGo: 15 });
  assert.equal(g55.pct, 0);
  const dan = grade(70);
  assert.equal(dan.label, "初段");
  assert.equal(dan.romaji, "shodan");
  assert.equal(dan.english, "first dan");
  assert.deepEqual(dan.next, { label: "二段", at: 90, toGo: 20 });
  assert.equal(grade(80).pct, 50); // halfway from 70 to 90
  const cap = grade(430);
  assert.equal(cap.label, "十段");
  assert.equal(cap.romaji, "jūdan");
  assert.equal(cap.english, "the path continues");
  assert.equal(cap.next, null);
  assert.equal(cap.pct, 100);
  const past = grade(1000);
  assert.equal(past.label, "十段"); // the cap holds
  assert.equal(past.next, null);
  // garbage in → ungraded, never a crash
  assert.equal(grade(-3).label, "無級");
  assert.equal(grade(NaN).label, "無級");
});

test("xp: a kata honor is 5 m, a clean day +15 m on top", () => {
  assert.equal(metersFor({ kata: 3 }), 15);
  assert.equal(metersFor({ tasks: 1, steps: 1, kata: 1 }), 40);
  const xp = xpSummary(
    { tasks: 0, steps: 0, kata: 4 },
    { kata: 2 },
    { cleanDays: 2, todayClean: true },
  );
  assert.equal(xp.totalM, 4 * 5 + 2 * 15); // 50
  assert.equal(xp.todayM, 2 * 5 + 15); // 25
  // without the bonus opts everything stays as before (pure fallback)
  assert.equal(xpSummary({ tasks: 1, steps: 0 }).totalM, 10);
});

test("momentum: kata count in the heatmap and XP, never the goal or the streak", () => {
  const s = state({
    completions: [
      done("2026-06-22", "kata", "k1"),
      done("2026-06-23", "kata", "k1"),
      done("2026-06-23", "kata", "k2"),
    ],
    settings: { dailyGoal: 1, streakFreezes: 0 },
  });
  const m = momentum(s, { today: "2026-06-23" });
  // goal + streak: kata-only days are invisible
  assert.equal(m.todayCount, 0);
  assert.equal(m.metGoal, false);
  assert.equal(m.streak.current, 0);
  assert.equal(m.streak.longest, 0);
  // heatmap + XP: showing up counts
  assert.equal(m.heat.at(-1).count, 2);
  assert.equal(m.heat.at(-2).count, 1);
  assert.equal(m.xp.totalM, 15);
  assert.equal(m.xp.todayM, 10);
  assert.equal(m.totalDone, 0); // totals stay task+step work
  // a real task alongside restores the streak math untouched by kata rows
  const mixed = momentum(
    state({
      completions: [done("2026-06-23", "task", "t"), done("2026-06-23", "kata", "k1")],
      settings: { dailyGoal: 1, streakFreezes: 0 },
    }),
    { today: "2026-06-23" },
  );
  assert.equal(mixed.todayCount, 1);
  assert.equal(mixed.metGoal, true);
  assert.equal(mixed.streak.current, 1);
  assert.equal(mixed.heat.at(-1).count, 2);
});

test("momentum: the discipline block — clean days, grace, and the week strip", () => {
  const kd = (day, activeIds, honoredIds) => ({ day, activeIds, honoredIds });
  const s = state({
    kataDays: [
      kd("2026-06-20", ["a", "b"], ["a", "b"]), // clean
      kd("2026-06-21", ["a", "b"], ["a"]), // partial
      kd("2026-06-22", ["a", "b"], ["b", "a"]), // clean
      kd("2026-06-23", ["a", "b"], ["a"]), // today, not clean yet
    ],
  });
  const m = momentum(s, { today: "2026-06-23" });
  const d = m.discipline;
  assert.equal(d.cleanDays, 2);
  assert.equal(d.cleanStreak, 1); // the 22nd; today is pending, the 21st broke the older run
  assert.equal(d.grade.label, "10級"); // 2 clean days ≥ the 10級 threshold, short of 9級's 3
  assert.equal(d.grade.romaji, "10th kyū");
  assert.deepEqual(d.grade.next, { label: "9級", at: 3, toGo: 1 });
  assert.equal(d.week.length, 7);
  assert.deepEqual(d.week.at(-1), { day: "2026-06-23", state: "pending" });
  assert.deepEqual(d.week.at(-2), { day: "2026-06-22", state: "clean" });
  assert.deepEqual(d.week.at(-3), { day: "2026-06-21", state: "partial" });
  assert.deepEqual(d.week.at(-4), { day: "2026-06-20", state: "clean" });
  assert.deepEqual(d.week.at(-5), { day: "2026-06-19", state: "none" });
  // XP earns the clean-day bonus: 2 clean days × 15 m (no completion rows here)
  assert.equal(m.xp.totalM, 30);
  // a clean TODAY counts in todayM and shows "clean" in the strip
  const cleanToday = momentum(state({ kataDays: [kd("2026-06-23", ["a"], ["a"])] }), {
    today: "2026-06-23",
  });
  assert.equal(cleanToday.discipline.cleanStreak, 1);
  assert.equal(cleanToday.discipline.week.at(-1).state, "clean");
  assert.equal(cleanToday.xp.todayM, 15);
  // no kata at all → a calm zero block
  const none = momentum(state(), { today: "2026-06-23" });
  assert.deepEqual(none.discipline.cleanDays, 0);
  assert.equal(none.discipline.cleanStreak, 0);
  assert.equal(none.discipline.grade.label, "無級");
  assert.ok(none.discipline.week.every((w) => w.state === "none" || w.state === "pending"));
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
