// db.test.js — schema, lean writes, validation, and full-state replace.
// Uses a throwaway DB file via MICHI_DB (set before importing db.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";

const DB = join(tmpdir(), `michi-test-${process.pid}.db`);
process.env.MICHI_DB = DB;

const db = await import("./db.js");

test.after(() => {
  for (const ext of ["", "-wal", "-shm"]) {
    try {
      rmSync(DB + ext);
    } catch {
      /* ignore */
    }
  }
});

test("empty state has defaults", () => {
  const s = db.getState();
  assert.deepEqual(s.roadmaps, []);
  assert.deepEqual(s.tasks, []);
  assert.equal(s.profile.onboarded, false);
  assert.equal(s.settings.dailyGoal, 3);
});

test("addTask appends and bumps rev", () => {
  const before = db.getState().rev;
  const s = db.addTask({ id: "t1", title: "Learn UART" });
  assert.equal(s.tasks.length, 1);
  assert.equal(s.tasks[0].title, "Learn UART");
  assert.equal(s.tasks[0].status, "todo");
  assert.equal(s.rev, before + 1);
});

test("setDone marks a task done with a timestamp, and can undo", () => {
  let s = db.setDone("task", "t1", true);
  assert.equal(s.tasks[0].status, "done");
  assert.ok(s.tasks[0].doneAt);
  s = db.setDone("task", "t1", false);
  assert.equal(s.tasks[0].status, "todo");
  assert.equal(s.tasks[0].doneAt, null);
});

test("setDone throws on a missing id", () => {
  assert.throws(() => db.setDone("task", "nope", true));
});

test("validateTask rejects bad shapes", () => {
  assert.ok(db.validateTask({ title: "no id" }));
  assert.ok(db.validateTask({ id: "x" })); // no title
  assert.ok(db.validateTask({ id: "x", title: "t", status: "weird" }));
  assert.ok(db.validateTask({ id: "x", title: "t", due: "not-a-date" }));
  assert.ok(db.validateTask({ id: "x", title: "t", due: "2024-02-30" })); // rollover date rejected
  assert.ok(db.validateTask({ id: "x", title: "t", recurrence: "monthly" }));
  assert.equal(db.validateTask({ id: "x", title: "t", recurrence: "daily" }), null);
  assert.equal(db.validateTask({ id: "x", title: "t", due: "2026-06-23" }), null);
});

test("putState replaces the full model and round-trips a roadmap tree", () => {
  const s = db.putState({
    roadmaps: [{ id: "rm", title: "Embedded", archived: false }],
    milestones: [{ id: "m", roadmapId: "rm", title: "Basics", position: 0 }],
    steps: [{ id: "st", milestoneId: "m", title: "GPIO", status: "done", position: 0 }],
    projects: [{ id: "p", title: "Blinky", status: "active" }],
    tasks: [{ id: "t", title: "wire it up", status: "todo" }],
  });
  assert.equal(s.roadmaps.length, 1);
  assert.equal(s.roadmaps[0].archived, false);
  assert.equal(s.milestones.length, 1);
  assert.equal(s.steps[0].status, "done");
  assert.equal(s.projects[0].status, "active");
  assert.equal(s.tasks.length, 1);
});

test("putState enforces optimistic concurrency", () => {
  const cur = db.getState();
  assert.throws(() => db.putState({ tasks: [] }, cur.rev - 1), db.ConflictError);
});

test("validateState rejects a milestone without a roadmapId", () => {
  assert.ok(db.validateState({ milestones: [{ id: "m", title: "x" }] }));
});

test("resetAll clears rows and restores default profile", () => {
  const s = db.resetAll();
  assert.deepEqual(s.roadmaps, []);
  assert.deepEqual(s.tasks, []);
  assert.equal(s.profile.onboarded, false);
});
