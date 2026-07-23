// goals.test.js — per-goal progress rollups from the completion log.
process.env.TZ = "UTC";
import { test } from "node:test";
import assert from "node:assert/strict";
import { goalProgress } from "./goals.js";

const base = {
  goals: [
    { id: "g1", title: "Climb V10" },
    { id: "g2", title: "Japanese N1" },
    { id: "g3", title: "untouched" },
  ],
  tasks: [
    { id: "t1", title: "session", goalId: "g1" },
    { id: "t2", title: "flashcards", goalId: "g2" },
    { id: "t3", title: "unattributed", goalId: null },
  ],
  steps: [{ id: "s1", title: "footwork", goalId: "g1" }],
  completions: [
    { day: "2026-07-20", kind: "task", refId: "t1" },
    { day: "2026-07-21", kind: "task", refId: "t1" }, // recurring — counts twice
    { day: "2026-07-21", kind: "step", refId: "s1" },
    { day: "2026-07-22", kind: "task", refId: "t2" },
    { day: "2026-07-22", kind: "task", refId: "t3" }, // unattributed — ignored
    { day: "2026-07-22", kind: "kata", refId: "k1" }, // kata never attributes
  ],
};

test("counts completion events per goal, joining the log to current attribution", () => {
  const p = goalProgress(base, { today: "2026-07-22", heatDays: 7 });
  // g1: t1 twice + s1 once = 3 events across 2 days
  assert.equal(p.g1.count, 3);
  assert.equal(p.g1.activeDays, 2);
  assert.equal(p.g1.lastDay, "2026-07-21");
  assert.equal(p.g1.linkedTasks, 1);
  assert.equal(p.g1.linkedSteps, 1);
  // g2: one flashcards completion
  assert.equal(p.g2.count, 1);
  assert.equal(p.g2.lastDay, "2026-07-22");
  // g3: nothing attributed
  assert.equal(p.g3.count, 0);
  assert.equal(p.g3.activeDays, 0);
  assert.equal(p.g3.lastDay, null);
});

test("attribution is retroactive — pointing an item's goalId picks up its whole history", () => {
  const moved = structuredClone(base);
  moved.tasks.find((t) => t.id === "t1").goalId = "g2"; // reassign the climbing sessions
  const p = goalProgress(moved, { today: "2026-07-22", heatDays: 7 });
  assert.equal(p.g1.count, 1); // only the step remains
  assert.equal(p.g2.count, 3); // t1 (×2) + t2 (×1) now credit g2
});

test("heat is exactly heatDays long, oldest→newest, ending today", () => {
  const p = goalProgress(base, { today: "2026-07-22", heatDays: 3 });
  assert.equal(p.g1.heat.length, 3);
  assert.deepEqual(
    p.g1.heat.map((h) => h.date),
    ["2026-07-20", "2026-07-21", "2026-07-22"],
  );
  assert.deepEqual(
    p.g1.heat.map((h) => h.count),
    [1, 2, 0],
  );
});

test("empty / no-goals state is safe", () => {
  assert.deepEqual(goalProgress({}, { today: "2026-07-22" }), {});
});
