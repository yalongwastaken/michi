// mutate.test.mjs — the delete mutators must sever every inbound reference,
// because the server now 400s a PUT that carries dangling refs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { deleteRoadmap, deleteStep, deleteProject, deleteTask } from "../src/lib/mutate.js";

function fixture() {
  return {
    roadmaps: [
      { id: "r1", title: "Embedded" },
      { id: "r2", title: "Rust" },
    ],
    milestones: [
      { id: "m1", roadmapId: "r1", title: "Basics" },
      { id: "m2", roadmapId: "r2", title: "Ownership" },
    ],
    steps: [
      { id: "s1", milestoneId: "m1", title: "GPIO" },
      { id: "s2", milestoneId: "m1", title: "UART" },
      { id: "s3", milestoneId: "m2", title: "Borrowing" },
    ],
    projects: [
      { id: "p1", title: "Blinky", roadmapId: "r1" },
      { id: "p2", title: "CLI tool", roadmapId: "r2" },
    ],
    tasks: [
      { id: "t1", title: "Read datasheet", stepId: "s1", projectId: "p1" },
      { id: "t2", title: "Wire it up", stepId: "s3", projectId: null },
      { id: "t3", title: "Loose task", stepId: null, projectId: "p2" },
    ],
  };
}

test("deleteRoadmap: removes the cascade and nulls project/task links", () => {
  const s = fixture();
  deleteRoadmap(s, "r1");
  assert.deepEqual(
    s.roadmaps.map((r) => r.id),
    ["r2"],
  );
  assert.deepEqual(
    s.milestones.map((m) => m.id),
    ["m2"],
  );
  assert.deepEqual(
    s.steps.map((st) => st.id),
    ["s3"],
  );
  // the project that pointed at r1 survives, unlinked
  assert.equal(s.projects.find((p) => p.id === "p1").roadmapId, null);
  assert.equal(s.projects.find((p) => p.id === "p2").roadmapId, "r2");
  // the task that pointed at a deleted step survives, unlinked
  assert.equal(s.tasks.find((t) => t.id === "t1").stepId, null);
  assert.equal(s.tasks.find((t) => t.id === "t2").stepId, "s3");
});

test("deleteStep: removes one step and unlinks its tasks only", () => {
  const s = fixture();
  deleteStep(s, "s1");
  assert.deepEqual(
    s.steps.map((st) => st.id),
    ["s2", "s3"],
  );
  assert.equal(s.tasks.find((t) => t.id === "t1").stepId, null);
  assert.equal(s.tasks.find((t) => t.id === "t2").stepId, "s3");
});

test("deleteProject: removes the project and unlinks its tasks", () => {
  const s = fixture();
  deleteProject(s, "p2");
  assert.deepEqual(
    s.projects.map((p) => p.id),
    ["p1"],
  );
  assert.equal(s.tasks.find((t) => t.id === "t3").projectId, null);
  assert.equal(s.tasks.find((t) => t.id === "t1").projectId, "p1");
});

test("deleteTask: removes just the task", () => {
  const s = fixture();
  deleteTask(s, "t2");
  assert.deepEqual(
    s.tasks.map((t) => t.id),
    ["t1", "t3"],
  );
});

test("delete helpers tolerate sparse state (missing arrays)", () => {
  const s = { roadmaps: [{ id: "r1", title: "Solo" }] };
  deleteRoadmap(s, "r1");
  assert.deepEqual(s.roadmaps, []);
  const s2 = { projects: [{ id: "p1", title: "Solo" }] };
  deleteProject(s2, "p1");
  assert.deepEqual(s2.projects, []);
});
