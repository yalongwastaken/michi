// planner.test.js — the day planner: obligations, continuity, rotation, budget,
// neglect ordering, and streak protection.
process.env.TZ = "UTC";
import { test } from "node:test";
import assert from "node:assert/strict";
import { planDay } from "./planner.js";

function state(over = {}) {
  return {
    roadmaps: [],
    milestones: [],
    steps: [],
    projects: [],
    tasks: [],
    completions: [],
    settings: {},
    ...over,
  };
}

// a roadmap with one milestone and N todo steps
function roadmap(id, stepIds) {
  return {
    roadmaps: [{ id, title: id, archived: false }],
    milestones: [{ id: `${id}_m`, roadmapId: id, title: "M", position: 0 }],
    steps: stepIds.map((sid, i) => ({
      id: sid,
      milestoneId: `${id}_m`,
      title: sid,
      status: "todo",
      position: i,
    })),
  };
}

test("obligations (overdue + due today) always make the plan, even over budget", () => {
  const s = state({
    tasks: [
      { id: "a", title: "overdue", status: "todo", due: "2026-06-20", estMin: 40 },
      { id: "b", title: "due", status: "todo", due: "2026-06-23", estMin: 40 },
    ],
  });
  const p = planDay(s, { today: "2026-06-23", budgetMin: 30 });
  assert.equal(p.items.length, 2);
  assert.ok(p.overflow);
  assert.equal(p.counts.due, 2);
  assert.equal(p.items[0].reason, "overdue");
});

test("fills remaining budget with steps, respecting the time budget", () => {
  const s = state(roadmap("R", ["s1", "s2", "s3", "s4"]));
  const p = planDay(s, { today: "2026-06-23", budgetMin: 60, defaultStepMin: 30 });
  // 60 / 30 = 2 steps fit
  assert.equal(p.items.length, 2);
  assert.equal(p.plannedMin, 60);
  assert.ok(p.items.every((i) => i.kind === "step"));
});

test("rotates across roadmaps instead of draining one", () => {
  const a = roadmap("A", ["a1", "a2", "a3"]);
  const b = roadmap("B", ["b1", "b2", "b3"]);
  const s = state({
    roadmaps: [...a.roadmaps, ...b.roadmaps],
    milestones: [...a.milestones, ...b.milestones],
    steps: [...a.steps, ...b.steps],
  });
  const p = planDay(s, { today: "2026-06-23", budgetMin: 60, defaultStepMin: 30 });
  const roadmapsHit = new Set(p.items.map((i) => i.roadmapId));
  assert.equal(roadmapsHit.size, 2); // one from each, not two from one
});

test("most-neglected roadmap goes first", () => {
  const a = roadmap("A", ["a1"]);
  const b = roadmap("B", ["b1"]);
  const s = state({
    roadmaps: [...a.roadmaps, ...b.roadmaps],
    milestones: [...a.milestones, ...b.milestones],
    steps: [...a.steps, ...b.steps],
    // A was worked recently; B never → B is more neglected, should come first
    completions: [{ id: "c1", day: "2026-06-22", kind: "step", refId: "a1", ts: "x" }],
  });
  // give budget for only one step
  const p = planDay(s, { today: "2026-06-23", budgetMin: 30, defaultStepMin: 30 });
  assert.equal(p.items.length, 1);
  assert.equal(p.items[0].roadmapId, "B");
});

test("in-progress steps are surfaced first (continuity)", () => {
  const s = state(roadmap("R", ["s1", "s2", "s3"]));
  s.steps[1].status = "doing"; // s2 is in progress
  const p = planDay(s, { today: "2026-06-23", budgetMin: 30, defaultStepMin: 30 });
  assert.equal(p.items[0].id, "s2");
  assert.equal(p.counts.continue, 1);
});

test("streak protection: returns one item even when budget is below a step", () => {
  const s = state(roadmap("R", ["s1"]));
  const p = planDay(s, { today: "2026-06-23", budgetMin: 5, defaultStepMin: 30 });
  assert.equal(p.items.length, 1);
  assert.equal(p.items[0].reason, "streak");
});

test("undated backlog tasks are planned (even with no roadmaps)", () => {
  const s = state({
    tasks: [
      { id: "b1", title: "tidy notes", status: "todo", estMin: 15 },
      { id: "b2", title: "watch a talk", status: "todo", estMin: 20 },
    ],
  });
  const p = planDay(s, { today: "2026-06-23", budgetMin: 60 });
  assert.equal(p.items.length, 2);
  assert.equal(p.plannedMin, 35);
  assert.ok(p.items.every((i) => i.kind === "task"));
});

test("a cheap task slots into a small leftover after a step", () => {
  const r = roadmap("R", ["s1"]); // one step @ default 30
  const s = state({ ...r, tasks: [{ id: "q", title: "quick", status: "todo", estMin: 10 }] });
  const p = planDay(s, { today: "2026-06-23", budgetMin: 45, defaultStepMin: 30 });
  // 30 (step) + 10 (task) = 40 ≤ 45; both fit
  assert.equal(p.items.length, 2);
  assert.equal(p.plannedMin, 40);
});

test("empty when there's nothing to do", () => {
  const p = planDay(state(), { today: "2026-06-23", budgetMin: 60 });
  assert.equal(p.items.length, 0);
  assert.match(p.why, /Nothing queued/);
});

test("recurring daily task counts as an obligation; archived roadmaps excluded", () => {
  const r = roadmap("R", ["s1"]);
  const s = state({
    ...r,
    roadmaps: [{ id: "R", title: "R", archived: true }],
    tasks: [{ id: "h", title: "read", status: "todo", recurrence: "daily" }],
  });
  const p = planDay(s, { today: "2026-06-23", budgetMin: 60 });
  assert.equal(p.counts.due, 1); // the daily habit
  assert.ok(!p.items.some((i) => i.kind === "step")); // archived roadmap contributes nothing
});
