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

test("digest handles an empty day gracefully", () => {
  const d = buildDigest(
    { roadmaps: [], milestones: [], steps: [], tasks: [], completions: [], settings: {} },
    { today: "2026-06-23" },
  );
  assert.match(d.text, /No streak yet/);
  assert.match(d.text, /Nothing planned/);
});
