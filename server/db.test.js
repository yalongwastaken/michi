// db.test.js — schema, lean writes, validation, and full-state replace.
// Uses a throwaway DB file via MICHI_DB (set before importing db.js).
// Pin the timezone: the activity-summary tests inject ISO timestamps and assert
// on the local day they land in (same reasoning as engine.test.js).
process.env.TZ = "UTC";
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";

const DB = join(tmpdir(), `michi-test-${process.pid}.db`);
process.env.MICHI_DB = DB;

const db = await import("./db.js");
const { momentum } = await import("./engine.js");

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

test("validateState rejects pathological numeric settings", () => {
  assert.ok(db.validateState({ settings: { streakFreezes: "Infinity" } }));
  assert.ok(db.validateState({ settings: { streakFreezes: 1e9 } }));
  assert.ok(db.validateState({ settings: { streakFreezes: -1 } }));
  assert.ok(db.validateState({ settings: { dailyMinutes: "a lot" } }));
  assert.ok(db.validateState({ settings: { dailyGoal: NaN } }));
  assert.ok(db.validateState({ settings: "dark" })); // not even an object
  assert.equal(db.validateState({ settings: { dailyGoal: 0 } }), null); // 0 = rest mode
  assert.equal(db.validateState({ settings: { streakFreezes: 5, theme: "dark" } }), null);
  assert.equal(db.validateState({ settings: {} }), null); // missing values stay fine
  assert.equal(db.validateState({}), null); // settings absent entirely
});

test("validateState rejects a non-string profile name", () => {
  assert.ok(db.validateState({ profile: { name: 42 } }));
  assert.ok(db.validateState({ profile: ["not", "an", "object"] }));
  assert.equal(db.validateState({ profile: { name: "Sam" } }), null);
  assert.equal(db.validateState({ profile: {} }), null);
});

test("replaceCompletions skips rows with an invalid day or kind, defaults a bad ts", () => {
  const s = db.replaceCompletions([
    { day: "2026-06-23", kind: "task", refId: "a" },
    { day: "not-a-day", kind: "task", refId: "bad-day" },
    { day: "2026-02-30", kind: "task", refId: "rollover-day" },
    { day: "2026-06-23", kind: "meal", refId: "bad-kind" },
    { day: "2026-06-22", kind: "step", refId: "d", ts: { weird: true } },
  ]);
  assert.deepEqual(s.completions.map((c) => c.refId).sort(), ["a", "d"]);
  assert.equal(s.completions.find((c) => c.refId === "d").ts, "2026-06-22"); // ts fell back to day
  // the surviving log still feeds momentum() without blowing up
  const m = momentum(s, { today: "2026-06-23" });
  assert.equal(m.daysActive, 2);
  assert.equal(m.streak.current, 2);
});

test("resetAll clears rows and restores default profile", () => {
  const s = db.resetAll();
  assert.deepEqual(s.roadmaps, []);
  assert.deepEqual(s.tasks, []);
  assert.equal(s.profile.onboarded, false);
});

test("validateState names a duplicate id", () => {
  const bad = db.validateState({
    tasks: [
      { id: "dup", title: "a" },
      { id: "dup", title: "b" },
    ],
  });
  assert.match(bad, /duplicate task id "dup"/);
});

test("validateState names dangling references", () => {
  assert.match(
    db.validateState({ milestones: [{ id: "m", roadmapId: "ghost", title: "x" }] }),
    /missing roadmap "ghost"/,
  );
  assert.match(
    db.validateState({
      roadmaps: [{ id: "r", title: "R" }],
      milestones: [{ id: "m", roadmapId: "r", title: "x" }],
      steps: [{ id: "s", milestoneId: "nope", title: "y" }],
    }),
    /missing milestone "nope"/,
  );
  assert.match(
    db.validateState({ tasks: [{ id: "t", title: "x", stepId: "ghost" }] }),
    /missing step "ghost"/,
  );
});

test("putState strips unknown extra keys instead of failing at the SQL layer", () => {
  const s = db.putState({
    tasks: [{ id: "xk", title: "extra keys", junk: "ignored", nested: { a: 1 } }],
  });
  const t = s.tasks.find((x) => x.id === "xk");
  assert.equal(t.title, "extra keys");
  assert.ok(!("junk" in t));
});

test("addTask ignores unknown keys", () => {
  const s = db.addTask({ id: "xk2", title: "junk-proof", bogus: { nested: true } });
  assert.ok(s.tasks.find((t) => t.id === "xk2"));
});

test("importAll replaces state + completions together", () => {
  const s = db.importAll({
    tasks: [{ id: "im1", title: "imported" }],
    completions: [{ day: "2026-06-20", kind: "task", refId: "im1" }],
  });
  assert.deepEqual(
    s.tasks.map((t) => t.id),
    ["im1"],
  );
  assert.equal(s.completions.length, 1);
});

test("importAll is atomic — a late failure leaves old data fully intact", () => {
  db.importAll({
    tasks: [{ id: "keep", title: "keep me" }],
    completions: [{ day: "2026-06-21", kind: "task", refId: "keep" }],
  });
  const before = db.getFullState(); // full: the rollback must cover completions too
  // this completion passes the shape guards but its refId can't be bound to SQL,
  // so it throws *after* the tables were rewritten — the rollback must cover both
  assert.throws(() =>
    db.importAll({
      tasks: [{ id: "incoming", title: "new stuff" }],
      completions: [{ day: "2026-06-22", kind: "task", refId: { object: true } }],
    }),
  );
  assert.deepEqual(db.getFullState(), before); // tables, completions and rev untouched
});

test("getState is slim: the completions log is not shipped on everyday reads/writes", () => {
  db.importAll({
    tasks: [{ id: "slim", title: "history stays server-side" }],
    completions: [{ day: "2026-06-19", kind: "task", refId: "slim" }],
  });
  // no `completions` key at all (not even an empty array) on the everyday paths
  assert.ok(!("completions" in db.getState()));
  assert.ok(!("completions" in db.setDone("task", "slim", true)));
  assert.ok(!("completions" in db.addTask({ id: "slim2", title: "another" })));
  // …while getFullState still carries the full log for export/import
  const full = db.getFullState();
  assert.ok(Array.isArray(full.completions));
  assert.ok(full.completions.some((c) => c.refId === "slim"));
});

test("everyday PUT leaves completions untouched (even an explicit completions key)", () => {
  db.importAll({
    tasks: [{ id: "keep2", title: "task with history" }],
    completions: [{ day: "2026-06-18", kind: "task", refId: "keep2" }],
  });
  const before = db.getFullState().completions;
  // a full-state save that replaces the model AND tries to blank the log
  const s = db.putState({ tasks: [{ id: "fresh", title: "replaced model" }], completions: [] });
  assert.ok(!("completions" in s)); // write response stays slim
  assert.deepEqual(db.getFullState().completions, before); // history survived the save
});

test("export → import round-trip retains completions", () => {
  db.importAll({
    tasks: [{ id: "rt", title: "round-trip" }],
    completions: [
      { day: "2026-06-16", kind: "task", refId: "rt" },
      { day: "2026-06-17", kind: "task", refId: "rt" },
    ],
  });
  const exported = db.getFullState(); // what GET /api/export serves
  db.resetAll();
  assert.equal(db.getFullState().completions.length, 0); // reset really cleared the log
  const restored = db.importAll(exported); // what POST /api/import does
  assert.deepEqual(restored.completions, exported.completions);
  assert.deepEqual(
    restored.tasks.map((t) => t.id),
    exported.tasks.map((t) => t.id),
  );
});

test("activity summary: cached counts follow the toggle path exactly", () => {
  db.resetAll();
  db.addTask({ id: "act", title: "cache me" });
  assert.deepEqual(db.getActivitySummary().totals, { tasks: 0, steps: 0 }); // built lazily, empty

  db.setDone("task", "act", true, "2026-06-22T12:00:00Z");
  let a = db.getActivitySummary();
  assert.deepEqual(a.byDay.get("2026-06-22"), { tasks: 1, steps: 0 });
  assert.deepEqual(a.totals, { tasks: 1, steps: 0 });

  // a same-day re-complete is a log no-op (UNIQUE) — the cache must not double-count
  db.setDone("task", "act", true, "2026-06-22T13:00:00Z");
  assert.deepEqual(db.getActivitySummary().totals, { tasks: 1, steps: 0 });

  // the same item completed on another day is a second row of real history
  db.setDone("task", "act", true, "2026-06-23T09:00:00Z");
  a = db.getActivitySummary();
  assert.equal(a.byDay.size, 2);
  assert.deepEqual(a.totals, { tasks: 2, steps: 0 });

  // toggle off retracts only that day's credit — and the emptied day stops
  // counting as "active" (daysActive reads byDay.size)
  db.setDone("task", "act", false, "2026-06-23T10:00:00Z");
  a = db.getActivitySummary();
  assert.equal(a.byDay.has("2026-06-23"), false);
  assert.deepEqual(a.byDay.get("2026-06-22"), { tasks: 1, steps: 0 });
  assert.deepEqual(a.totals, { tasks: 1, steps: 0 });

  // a second undo has nothing left to retract — no drift below zero
  db.setDone("task", "act", false, "2026-06-23T11:00:00Z");
  assert.deepEqual(db.getActivitySummary().totals, { tasks: 1, steps: 0 });
});

test("momentum reads the cached summary — the raw log needn't ride along", () => {
  db.resetAll();
  db.addTask({ id: "mom", title: "cache-fed" });
  db.setDone("task", "mom", true, "2026-06-23T12:00:00Z");
  // getState() carries no completions key at all; momentum still sees the history
  const m = momentum(db.getState(), { today: "2026-06-23" });
  assert.equal(m.todayCount, 1);
  assert.equal(m.streak.current, 1);
  assert.equal(m.daysActive, 1);
  assert.equal(m.xp.totalM, 10);
  assert.equal(m.xp.todayM, 10);
});

// ── project ↔ roadmap links ─────────────────────────────────────────────────────

test("projects round-trip roadmapId; a roadmap deleted by absence nulls it", () => {
  db.resetAll();
  let s = db.putState({
    roadmaps: [{ id: "lr", title: "Linked Track" }],
    projects: [{ id: "lp", title: "Build it", roadmapId: "lr" }],
  });
  assert.equal(s.projects[0].roadmapId, "lr");
  // the roadmap vanishes but the project still carries the ref (putState itself
  // doesn't validate — the endpoint does): replaceAll delivers the SET-NULL the
  // tasks FK promises but a full reinsert never triggers
  s = db.putState({ projects: [{ id: "lp", title: "Build it", roadmapId: "lr" }] });
  assert.equal(s.projects[0].roadmapId, null);
});

test("validateState names a dangling project→roadmap ref", () => {
  assert.match(
    db.validateState({ projects: [{ id: "p", title: "x", roadmapId: "ghost" }] }),
    /missing roadmap "ghost"/,
  );
  assert.equal(
    db.validateState({
      roadmaps: [{ id: "r", title: "R" }],
      projects: [{ id: "p", title: "x", roadmapId: "r" }],
    }),
    null,
  );
});

// ── trash: soft-delete on the full-state replace ────────────────────────────────

// a small tree to delete from; putState from empty never trashes (nothing vanishes)
const TREE = {
  roadmaps: [{ id: "tr-rm", title: "Doomed Track" }],
  milestones: [
    { id: "tr-m1", roadmapId: "tr-rm", title: "One", position: 0 },
    { id: "tr-m2", roadmapId: "tr-rm", title: "Two", position: 1 },
  ],
  steps: [
    { id: "tr-s1", milestoneId: "tr-m1", title: "A", position: 0 },
    { id: "tr-s2", milestoneId: "tr-m1", title: "B", position: 1 },
    { id: "tr-s3", milestoneId: "tr-m2", title: "C", position: 0, notes: "keep my notes" },
  ],
  projects: [{ id: "tr-p", title: "Doomed Project", roadmapId: "tr-rm" }],
  tasks: [{ id: "tr-t", title: "Doomed Task", stepId: "tr-s1", projectId: "tr-p" }],
};

test("full-state PUT trashes a vanished roadmap as ONE subtree snapshot", () => {
  db.resetAll();
  db.putState(TREE);
  db.putState({ ...TREE, roadmaps: [], milestones: [], steps: [], tasks: [] }); // project survives
  const items = db.listTrash();
  // the roadmap row carries its milestones + steps — they get no rows of their own
  assert.deepEqual(items.map((i) => i.kind).sort(), ["roadmap", "task"]);
  const rm = items.find((i) => i.kind === "roadmap");
  assert.equal(rm.title, "Doomed Track");
  assert.equal(rm.counts, "2 milestones · 3 steps");
  assert.match(rm.id, /^tr_/);
  assert.ok(rm.deletedAt);
  const task = items.find((i) => i.kind === "task");
  assert.equal(task.counts, null); // nothing to count on a lone task
});

test("milestones/steps removed while their roadmap survives are NOT trashed", () => {
  db.resetAll();
  db.putState(TREE);
  // routine editing: one milestone and its steps gone, the roadmap still there
  db.putState({
    ...TREE,
    milestones: TREE.milestones.slice(0, 1),
    steps: TREE.steps.slice(0, 2),
    tasks: [{ id: "tr-t", title: "Doomed Task" }], // drop refs, keep the task
  });
  assert.deepEqual(db.listTrash(), []);
});

test("a vanished project gets its own trash row; importAll never trashes", () => {
  db.resetAll();
  db.putState(TREE);
  db.putState({ ...TREE, projects: [], tasks: [{ id: "tr-t", title: "Doomed Task" }] });
  assert.deepEqual(
    db.listTrash().map((i) => i.kind),
    ["project"],
  );
  db.purgeAllTrash();
  // import is a restore/replace semantic — the whole old model vanishing is the point
  db.importAll({ tasks: [{ id: "fresh", title: "imported over everything" }] });
  assert.deepEqual(db.listTrash(), []);
});

test("restoreTrash: the subtree comes back under its original ids", () => {
  db.resetAll();
  db.putState(TREE);
  const before = db.getState().rev;
  db.putState({ ...TREE, roadmaps: [], milestones: [], steps: [], tasks: [] });
  const entry = db.listTrash().find((i) => i.kind === "roadmap");
  const { state, restored } = db.restoreTrash(entry.id);
  assert.deepEqual(restored, {
    id: entry.id,
    kind: "roadmap",
    title: "Doomed Track",
    remapped: false,
  });
  assert.deepEqual(
    state.roadmaps.map((r) => r.id),
    ["tr-rm"],
  );
  assert.equal(state.milestones.length, 2);
  assert.equal(state.steps.length, 3);
  assert.equal(state.steps.find((s) => s.id === "tr-s3").notes, "keep my notes");
  assert.ok(state.rev > before); // restore is a real write — the rev moved
  // the restored row left the trash (only the task row remains)
  assert.deepEqual(
    db.listTrash().map((i) => i.kind),
    ["task"],
  );
  assert.throws(() => db.restoreTrash(entry.id), /not found/); // and can't restore twice
});

test("restoreTrash: recreated ids force a full remap — restores never collide", () => {
  db.resetAll();
  db.putState(TREE);
  db.putState({ ...TREE, roadmaps: [], milestones: [], steps: [], tasks: [] });
  // the user rebuilt a roadmap under the SAME id before restoring
  db.putState({
    ...TREE,
    roadmaps: [{ id: "tr-rm", title: "Rebuilt" }],
    milestones: [],
    steps: [],
    tasks: [],
  });
  const entry = db.listTrash().find((i) => i.kind === "roadmap");
  const { state, restored } = db.restoreTrash(entry.id);
  assert.equal(restored.remapped, true);
  assert.equal(state.roadmaps.length, 2); // the rebuild AND the restore coexist
  const back = state.roadmaps.find((r) => r.title === "Doomed Track");
  assert.notEqual(back.id, "tr-rm");
  assert.match(back.id, /^rm_/);
  // the whole subtree was remapped consistently, not just the colliding id
  const ms = state.milestones.filter((m) => m.roadmapId === back.id);
  assert.equal(ms.length, 2);
  for (const m of ms) {
    assert.match(m.id, /^ms_/);
  }
  const msIds = new Set(ms.map((m) => m.id));
  assert.equal(state.steps.filter((s) => msIds.has(s.milestoneId)).length, 3);
});

test("restoreTrash: outward refs that no longer resolve are nulled", () => {
  db.resetAll();
  db.putState(TREE);
  // the task goes first (trashed with live stepId/projectId in its snapshot)…
  db.putState({ ...TREE, tasks: [] });
  // …then its step's roadmap and its project are deleted too
  db.putState({ projects: [], roadmaps: [], milestones: [], steps: [], tasks: [] });
  const entry = db.listTrash().find((i) => i.kind === "task");
  const { state } = db.restoreTrash(entry.id);
  const t = state.tasks.find((x) => x.title === "Doomed Task");
  assert.equal(t.stepId, null); // a dangling ref would violate the FK
  assert.equal(t.projectId, null);
});

test("trash retention: capped at the newest 50, and old rows age out", () => {
  db.resetAll();
  const tasks = Array.from({ length: 55 }, (_, i) => ({
    id: `ret${i}`,
    title: `ret ${i}`,
    position: i,
  }));
  db.putState({ tasks });
  db.putState({ tasks: [] }); // 55 deletes in one diff → retention trims to 50
  const items = db.listTrash();
  assert.equal(items.length, 50);
  const titles = new Set(items.map((i) => i.title));
  for (let i = 0; i < 5; i++) {
    assert.ok(!titles.has(`ret ${i}`), `oldest row "ret ${i}" should have been dropped`);
  }
  assert.ok(titles.has("ret 54"));
  // a row past the 30-day window is purged by the next insert
  const stale = new Date(Date.now() - 31 * 86400000).toISOString();
  db.db
    .prepare("INSERT INTO trash(id, kind, title, payload, deleted_at) VALUES(?, ?, ?, ?, ?)")
    .run("tr_stale", "task", "stale", "{}", stale);
  db.putState({ tasks: [{ id: "one-more", title: "one more" }] });
  db.putState({ tasks: [] }); // triggers an insert → retention runs
  assert.ok(!db.listTrash().some((i) => i.id === "tr_stale"));
});

test("purgeTrash / purgeAllTrash / reset all empty the trash for good", () => {
  db.resetAll();
  db.putState({ tasks: [{ id: "px", title: "purge me" }] });
  db.putState({ tasks: [] });
  const [item] = db.listTrash();
  assert.equal(db.purgeTrash(item.id), true);
  assert.equal(db.purgeTrash(item.id), false); // already gone
  db.putState({ tasks: [{ id: "py", title: "and me" }] });
  db.putState({ tasks: [] });
  assert.equal(db.purgeAllTrash(), 1);
  db.putState({ tasks: [{ id: "pz", title: "me too" }] });
  db.putState({ tasks: [] });
  db.resetAll(); // "erase everything" leaves no residue in the trash either
  assert.deepEqual(db.listTrash(), []);
});

test("activity summary: import / restore / reset invalidate the cache wholesale", () => {
  db.getActivitySummary(); // make sure it's built, so any staleness would show
  db.importAll({
    tasks: [{ id: "imp", title: "imported" }],
    completions: [
      { day: "2026-06-20", kind: "task", refId: "imp" },
      { day: "2026-06-21", kind: "step", refId: "ghost" },
    ],
  });
  assert.deepEqual(db.getActivitySummary().totals, { tasks: 1, steps: 1 });

  db.replaceCompletions([{ day: "2026-06-19", kind: "task", refId: "imp" }]);
  assert.deepEqual(db.getActivitySummary().totals, { tasks: 1, steps: 0 });

  db.resetAll();
  const a = db.getActivitySummary();
  assert.equal(a.byDay.size, 0);
  assert.deepEqual(a.totals, { tasks: 0, steps: 0 });
});
