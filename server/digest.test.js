process.env.TZ = "UTC";
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDigest } from "./digest.js";

function state(over = {}) {
  return {
    roadmaps: [{ id: "R", title: "Embedded", archived: false }],
    milestones: [{ id: "m", roadmapId: "R", title: "Basics", position: 0 }],
    steps: [{ id: "s1", milestoneId: "m", title: "GPIO", status: "todo", position: 0 }],
    projects: [],
    tasks: [{ id: "t1", title: "Read datasheet", status: "todo", due: "2026-06-23", estMin: 20 }],
    completions: [{ id: "c", day: "2026-06-23", kind: "step", refId: "x" }],
    profile: { name: "Sam" },
    settings: { dailyMinutes: 60, dailyGoal: 3, streakFreezes: 2 },
    ...over,
  };
}

test("digest text includes date, streak, plan items, and a nudge", () => {
  const d = buildDigest(state(), { today: "2026-06-23", budgetMin: 60 });
  assert.match(d.text, /^Michi — /m);
  assert.match(d.text, /Sam/);
  assert.match(d.text, /Streak: 1 day/);
  assert.match(d.text, /Read datasheet/);
  assert.match(d.text, /GPIO — Embedded/);
  assert.equal(typeof d.text, "string");
  assert.ok(d.plan.items.length >= 1);
});

test("digest tolerates a non-string profile name", () => {
  const d = buildDigest(state({ profile: { name: 42 } }), { today: "2026-06-23", budgetMin: 60 });
  assert.match(d.text, /^Michi — /m);
  assert.doesNotMatch(d.text, /42/); // not rendered, not crashed
});

test("digest handles an empty day gracefully", () => {
  const d = buildDigest(
    { roadmaps: [], milestones: [], steps: [], tasks: [], completions: [], settings: {} },
    { today: "2026-06-23" },
  );
  assert.match(d.text, /No streak yet/);
  assert.match(d.text, /Nothing planned/);
});

test("morning stays the default and carries its mode", () => {
  const d = buildDigest(state(), { today: "2026-06-23", budgetMin: 60 });
  assert.equal(d.mode, "morning");
  assert.ok(d.plan); // the morning shape is unchanged
});

test("evening: what happened today, a kept streak, and tomorrow's glimpse", () => {
  const d = buildDigest(state(), { today: "2026-06-23", budgetMin: 60, mode: "evening" });
  assert.equal(d.mode, "evening");
  assert.match(d.text, /· evening/);
  assert.match(d.text, /Today: 1 done · \+25 m on the path/); // one step = 25 m
  assert.match(d.text, /Streak: 1 day — kept\./);
  assert.match(d.text, /Tomorrow:/);
  assert.match(d.text, /Read datasheet.*\[overdue\]/); // due 06-23 < tomorrow
  assert.match(d.text, /GPIO — Embedded/); // next step on the path
  assert.equal(d.today.done, 1);
  assert.equal(d.today.meters, 25);
  assert.ok(d.tomorrow.length >= 1 && d.tomorrow.length <= 3);
});

test("evening: an idle day with freezes left leans on a freeze", () => {
  const d = buildDigest(state(), { today: "2026-06-24", mode: "evening" });
  assert.match(d.text, /Today: nothing checked off — it happens\./);
  // 2 freezes in the budget, one is being spent on today → 1 left after
  assert.match(d.text, /Streak: 1 day — a freeze will cover today \(1 left after\)\./);
});

test("evening: an idle day with no freezes is at risk — gently", () => {
  const d = buildDigest(state({ settings: { dailyMinutes: 60, streakFreezes: 0 } }), {
    today: "2026-06-24",
    mode: "evening",
  });
  assert.match(d.text, /at risk; one small thing before bed keeps it/);
});

// ── kata lines ──────────────────────────────────────────────────────────────────

const KATA = [
  { id: "ka", title: "greyscale phone", builtinId: "greyscale-phone", active: true },
  { id: "kb", title: "shutdown ritual", builtinId: "shutdown", active: true },
  { id: "kc", title: "retired form", active: false },
];

test("morning: active kata are listed on one line (retired ones aren't)", () => {
  const d = buildDigest(state({ kata: KATA }), { today: "2026-06-23", budgetMin: 60 });
  assert.match(d.text, /^Kata: greyscale phone · shutdown ritual$/m);
  assert.doesNotMatch(d.text, /retired form/);
  assert.deepEqual(d.kata, ["greyscale phone", "shutdown ritual"]);
});

test("morning/evening: no kata, no line", () => {
  for (const mode of ["morning", "evening"]) {
    const d = buildDigest(state(), { today: "2026-06-23", budgetMin: 60, mode });
    assert.doesNotMatch(d.text, /Kata:/);
  }
  const evening = buildDigest(state(), { today: "2026-06-23", mode: "evening" });
  assert.equal(evening.kata, null);
});

test("evening: partial honors name the first still-open form", () => {
  const d = buildDigest(
    state({
      kata: KATA,
      kataDays: [{ day: "2026-06-23", activeIds: ["ka", "kb"], honoredIds: ["ka"] }],
    }),
    { today: "2026-06-23", mode: "evening" },
  );
  assert.match(d.text, /Kata: 1 of 2 honored — shutdown ritual still open\./);
  assert.deepEqual(d.kata, { honored: 1, total: 2, clean: false });
});

test("evening: a clean day holds the 型 — even if the set grew after the snapshot", () => {
  const d = buildDigest(
    state({
      kata: KATA,
      kataDays: [{ day: "2026-06-23", activeIds: ["ka", "kb"], honoredIds: ["ka", "kb"] }],
    }),
    { today: "2026-06-23", mode: "evening" },
  );
  assert.match(d.text, /Kata: a clean day — 型 held\./);
  assert.deepEqual(d.kata, { honored: 2, total: 2, clean: true });
  // the set changed mid-day: a third active form appears AFTER the snapshot was
  // honored in full — the snapshot wins, the day stays clean
  const grew = buildDigest(
    state({
      kata: KATA.map((k) => ({ ...k, active: true })),
      kataDays: [{ day: "2026-06-23", activeIds: ["ka", "kb"], honoredIds: ["ka", "kb"] }],
    }),
    { today: "2026-06-23", mode: "evening" },
  );
  assert.match(grew.text, /Kata: a clean day — 型 held\./);
  assert.deepEqual(grew.kata, { honored: 2, total: 3, clean: true });
});

test("evening: nothing honored yet reads as 0 of N, first form named", () => {
  const d = buildDigest(state({ kata: KATA }), { today: "2026-06-23", mode: "evening" });
  assert.match(d.text, /Kata: 0 of 2 honored — greyscale phone still open\./);
});

test("evening: no streak and an empty tomorrow stay calm", () => {
  const d = buildDigest(
    { roadmaps: [], milestones: [], steps: [], tasks: [], completions: [], settings: {} },
    { today: "2026-06-23", mode: "evening" },
  );
  assert.match(d.text, /No streak on the line — tomorrow starts one\./);
  assert.match(d.text, /Tomorrow is open/);
  assert.deepEqual(d.tomorrow, []);
});
