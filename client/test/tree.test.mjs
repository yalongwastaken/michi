import { test } from "node:test";
import assert from "node:assert/strict";
import { roadmapTree, nextPosition } from "../src/lib/tree.js";

test("roadmapTree nests milestones + steps and computes progress", () => {
  const state = {
    roadmaps: [{ id: "rm", title: "Embedded", color: "#10B981" }],
    milestones: [
      { id: "m2", roadmapId: "rm", title: "Second", position: 1 },
      { id: "m1", roadmapId: "rm", title: "First", position: 0 },
    ],
    steps: [
      { id: "s1", milestoneId: "m1", status: "done", position: 0 },
      { id: "s2", milestoneId: "m1", status: "todo", position: 1 },
      { id: "s3", milestoneId: "m2", status: "done", position: 0 },
    ],
  };
  const [rm] = roadmapTree(state);
  assert.equal(rm.milestones.length, 2);
  assert.equal(rm.milestones[0].title, "First"); // sorted by position
  assert.equal(rm.done, 2);
  assert.equal(rm.total, 3);
  assert.equal(rm.pct, 67);
  assert.equal(rm.complete, false);
});

test("complete means done === total exactly — pct rounding may say 100 early", () => {
  const steps = Array.from({ length: 200 }, (_, i) => ({
    id: `s${i}`,
    milestoneId: "m",
    status: i < 199 ? "done" : "todo",
    position: i,
  }));
  const state = {
    roadmaps: [{ id: "rm", title: "Marathon" }],
    milestones: [{ id: "m", roadmapId: "rm", title: "Long haul", position: 0 }],
    steps,
  };
  const [rm] = roadmapTree(state);
  assert.equal(rm.pct, 100); // display math rounds 199/200 up…
  assert.equal(rm.complete, false); // …but the path is not walked
  steps[199].status = "done";
  const [walked] = roadmapTree(state);
  assert.equal(walked.complete, true);
  // an empty roadmap is never "complete"
  const [empty] = roadmapTree({ roadmaps: [{ id: "e" }], milestones: [], steps: [] });
  assert.equal(empty.complete, false);
});

test("nextPosition returns max+1 (append to the end)", () => {
  assert.equal(nextPosition([]), 0);
  assert.equal(nextPosition([{ position: 0 }, { position: 3 }, { position: 1 }]), 4);
});
