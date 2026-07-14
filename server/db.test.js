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
  assert.equal(s.profile.mascot, "shiba"); // the default companion
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

test("validateState accepts each of the nine companions and rejects strangers", () => {
  for (const id of [
    "shiba",
    "panda",
    "daruma",
    "kitsune",
    "tanuki",
    "raccoon",
    "maneki",
    "rabbit",
    "crane",
  ]) {
    assert.equal(db.validateState({ profile: { mascot: id } }), null);
  }
  assert.ok(db.validateState({ profile: { mascot: "dragon" } }).includes("profile.mascot"));
  assert.ok(db.validateState({ profile: { mascot: "" } }).includes("profile.mascot"));
  assert.equal(db.validateState({ profile: { name: "Sam" } }), null); // absent → default applies
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
  assert.deepEqual(db.getActivitySummary().totals, { tasks: 0, steps: 0, kata: 0 }); // built lazily, empty

  db.setDone("task", "act", true, "2026-06-22T12:00:00Z");
  let a = db.getActivitySummary();
  assert.deepEqual(a.byDay.get("2026-06-22"), { tasks: 1, steps: 0, kata: 0 });
  assert.deepEqual(a.totals, { tasks: 1, steps: 0, kata: 0 });

  // a same-day re-complete is a log no-op (UNIQUE) — the cache must not double-count
  db.setDone("task", "act", true, "2026-06-22T13:00:00Z");
  assert.deepEqual(db.getActivitySummary().totals, { tasks: 1, steps: 0, kata: 0 });

  // the same item completed on another day is a second row of real history
  db.setDone("task", "act", true, "2026-06-23T09:00:00Z");
  a = db.getActivitySummary();
  assert.equal(a.byDay.size, 2);
  assert.deepEqual(a.totals, { tasks: 2, steps: 0, kata: 0 });

  // toggle off retracts only that day's credit — and the emptied day stops
  // counting as "active" (daysActive reads byDay.size)
  db.setDone("task", "act", false, "2026-06-23T10:00:00Z");
  a = db.getActivitySummary();
  assert.equal(a.byDay.has("2026-06-23"), false);
  assert.deepEqual(a.byDay.get("2026-06-22"), { tasks: 1, steps: 0, kata: 0 });
  assert.deepEqual(a.totals, { tasks: 1, steps: 0, kata: 0 });

  // a second undo has nothing left to retract — no drift below zero
  db.setDone("task", "act", false, "2026-06-23T11:00:00Z");
  assert.deepEqual(db.getActivitySummary().totals, { tasks: 1, steps: 0, kata: 0 });
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

test("a step deleted while its roadmap survives gets a trash row; milestones never do", () => {
  db.resetAll();
  db.putState(TREE);
  // one milestone edited away while the roadmap stays: the milestone itself is
  // routine editing (no row), but its step is a real delete — the client has a
  // per-step delete button, so the safety net must cover steps too
  db.putState({
    ...TREE,
    milestones: TREE.milestones.slice(0, 1),
    steps: TREE.steps.slice(0, 2),
    tasks: [{ id: "tr-t", title: "Doomed Task" }], // drop refs, keep the task
  });
  const items = db.listTrash();
  assert.deepEqual(
    items.map((i) => i.kind),
    ["step"],
  );
  assert.equal(items[0].title, "C");
  assert.equal(items[0].counts, null); // nothing to count on a lone step
});

test("the per-step delete is trashed — and steps inside a roadmap row aren't doubled", () => {
  db.resetAll();
  db.putState(TREE);
  // the client's step delete: the step vanishes, the task that pointed at it is unlinked
  db.putState({
    ...TREE,
    steps: TREE.steps.filter((s) => s.id !== "tr-s1"),
    tasks: [{ id: "tr-t", title: "Doomed Task", projectId: "tr-p" }],
  });
  assert.deepEqual(
    db.listTrash().map((i) => [i.kind, i.title]),
    [["step", "A"]],
  );
  // now the whole roadmap goes: its remaining steps travel INSIDE the roadmap
  // row — no extra step rows appear alongside it
  db.putState({
    projects: TREE.projects.map((p) => ({ ...p, roadmapId: null })),
    tasks: [{ id: "tr-t", title: "Doomed Task", projectId: "tr-p" }],
  });
  assert.deepEqual(
    db
      .listTrash()
      .map((i) => i.kind)
      .sort(),
    ["roadmap", "step"],
  );
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

test("putState returns a `trashed` receipt naming exactly what the PUT deleted", () => {
  db.resetAll();
  let s = db.putState({ tasks: [{ id: "rc", title: "receipt me" }] });
  assert.deepEqual(s.trashed, []); // nothing vanished — an empty receipt, always present
  s = db.putState({ tasks: [] });
  assert.equal(s.trashed.length, 1);
  assert.equal(s.trashed[0].kind, "task");
  assert.equal(s.trashed[0].title, "receipt me");
  assert.match(s.trashed[0].id, /^tr_/);
  // the receipt ids ARE the trash rows — an undo can bind to them directly
  assert.deepEqual(
    db.listTrash().map((r) => r.id),
    s.trashed.map((r) => r.id),
  );
  // import never trashes (replace semantics), so its response carries no receipt
  assert.ok(!("trashed" in db.importAll({ tasks: [] })));
});

test("restoreTrash: a lone step reattaches to its surviving milestone, links included", () => {
  db.resetAll();
  db.putState(TREE);
  // the client's step delete: the step goes, the task that pointed at it is unlinked
  db.putState({
    ...TREE,
    steps: TREE.steps.filter((s) => s.id !== "tr-s1"),
    tasks: [{ id: "tr-t", title: "Doomed Task", projectId: "tr-p" }],
  });
  const entry = db.listTrash().find((i) => i.kind === "step");
  const { state, restored } = db.restoreTrash(entry.id);
  assert.deepEqual(restored, { id: entry.id, kind: "step", title: "A", remapped: false });
  const back = state.steps.find((s) => s.id === "tr-s1");
  assert.equal(back.milestoneId, "tr-m1"); // hanging off its original milestone
  // the severed inbound link is stitched back (the task hadn't been repointed)
  assert.equal(state.tasks.find((t) => t.id === "tr-t").stepId, "tr-s1");
});

test("restoreTrash: a recreated step id remaps — and the task link follows the fresh id", () => {
  db.resetAll();
  db.putState(TREE);
  db.putState({
    ...TREE,
    steps: TREE.steps.filter((s) => s.id !== "tr-s1"),
    tasks: [{ id: "tr-t", title: "Doomed Task" }],
  });
  // the user rebuilt a step under the SAME id before restoring
  db.putState({
    ...TREE,
    steps: [
      { id: "tr-s1", milestoneId: "tr-m1", title: "Rebuilt", position: 5 },
      ...TREE.steps.slice(1),
    ],
    tasks: [{ id: "tr-t", title: "Doomed Task" }],
  });
  const entry = db.listTrash().find((i) => i.kind === "step");
  const { state, restored } = db.restoreTrash(entry.id);
  assert.equal(restored.remapped, true);
  const back = state.steps.find((s) => s.title === "A");
  assert.notEqual(back.id, "tr-s1");
  assert.match(back.id, /^step_/);
  // the re-attached link points at the FRESH id, not the rebuilt impostor
  assert.equal(state.tasks.find((t) => t.id === "tr-t").stepId, back.id);
});

test("restoreTrash: a step whose milestone is gone refuses with a clear conflict", () => {
  db.resetAll();
  db.putState(TREE);
  // the step goes first…
  db.putState({
    ...TREE,
    steps: TREE.steps.filter((s) => s.id !== "tr-s1"),
    tasks: [{ id: "tr-t", title: "Doomed Task" }],
  });
  // …then the whole roadmap (taking milestone tr-m1 with it)
  db.putState({
    projects: TREE.projects.map((p) => ({ ...p, roadmapId: null })),
    tasks: [{ id: "tr-t", title: "Doomed Task" }],
  });
  const entry = db.listTrash().find((i) => i.kind === "step");
  assert.throws(() => db.restoreTrash(entry.id), db.ConflictError);
  assert.throws(() => db.restoreTrash(entry.id), /restore the whole roadmap/);
  // the row is still in the trash — a refused restore consumes nothing
  assert.ok(db.listTrash().some((i) => i.id === entry.id));
});

test("restoreTrash: a restored roadmap re-attaches the project/task links it severed", () => {
  db.resetAll();
  db.putState(TREE);
  // delete the roadmap; the project and task survive, unlinked (as the client does)
  db.putState({
    projects: TREE.projects.map((p) => ({ ...p, roadmapId: null })),
    tasks: [{ id: "tr-t", title: "Doomed Task", projectId: "tr-p" }],
  });
  const entry = db.listTrash().find((i) => i.kind === "roadmap");
  const { state } = db.restoreTrash(entry.id);
  assert.equal(state.projects.find((p) => p.id === "tr-p").roadmapId, "tr-rm");
  assert.equal(state.tasks.find((t) => t.id === "tr-t").stepId, "tr-s1");
});

test("restoreTrash: a link the user repointed meanwhile is left alone", () => {
  db.resetAll();
  const other = { id: "tr-rm2", title: "Other Track" };
  db.putState({ ...TREE, roadmaps: [...TREE.roadmaps, other] });
  // delete the doomed roadmap, project unlinked…
  db.putState({
    roadmaps: [other],
    projects: TREE.projects.map((p) => ({ ...p, roadmapId: null })),
    tasks: [{ id: "tr-t", title: "Doomed Task", projectId: "tr-p" }],
  });
  // …then the user points the project somewhere else before undoing
  db.putState({
    roadmaps: [other],
    projects: TREE.projects.map((p) => ({ ...p, roadmapId: "tr-rm2" })),
    tasks: [{ id: "tr-t", title: "Doomed Task", projectId: "tr-p" }],
  });
  const entry = db.listTrash().find((i) => i.kind === "roadmap");
  const { state } = db.restoreTrash(entry.id);
  // the repointed link is respected; the never-repointed task link comes back
  assert.equal(state.projects.find((p) => p.id === "tr-p").roadmapId, "tr-rm2");
  assert.equal(state.tasks.find((t) => t.id === "tr-t").stepId, "tr-s1");
});

test("restoreTrash: a restored project re-attaches its task links", () => {
  db.resetAll();
  db.putState(TREE);
  db.putState({
    ...TREE,
    projects: [],
    tasks: [{ id: "tr-t", title: "Doomed Task", stepId: "tr-s1" }],
  });
  const entry = db.listTrash().find((i) => i.kind === "project");
  const { state } = db.restoreTrash(entry.id);
  assert.equal(state.tasks.find((t) => t.id === "tr-t").projectId, "tr-p");
});

test("trash retention: capped at the newest 200, and old rows age out", () => {
  db.resetAll();
  const tasks = Array.from({ length: 205 }, (_, i) => ({
    id: `ret${i}`,
    title: `ret ${i}`,
    position: i,
  }));
  db.putState({ tasks });
  db.putState({ tasks: [] }); // 205 deletes in one diff → retention trims to 200
  const items = db.listTrash();
  assert.equal(items.length, 200);
  const titles = new Set(items.map((i) => i.title));
  for (let i = 0; i < 5; i++) {
    assert.ok(!titles.has(`ret ${i}`), `oldest row "ret ${i}" should have been dropped`);
  }
  assert.ok(titles.has("ret 204"));
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

// ── kata: daily forms + the honor ledger ────────────────────────────────────────

const KATA = [
  { id: "kata-a", title: "greyscale phone", builtinId: "greyscale-phone", position: 0 },
  { id: "kata-b", title: "shutdown ritual", builtinId: "shutdown", position: 1 },
  { id: "kata-c", title: "my own form", note: "custom, no builtin", active: false, position: 2 },
];

test("kata round-trip the full-state PUT (camelCase, active as a real bool)", () => {
  db.resetAll();
  const s = db.putState({ kata: KATA });
  assert.equal(s.kata.length, 3);
  assert.deepEqual(
    s.kata.map((k) => k.id),
    ["kata-a", "kata-b", "kata-c"],
  );
  assert.equal(s.kata[0].builtinId, "greyscale-phone");
  assert.equal(s.kata[0].active, true); // absent → the schema default
  assert.equal(s.kata[2].active, false);
  assert.equal(s.kata[2].note, "custom, no builtin");
  assert.ok(s.kata[0].createdAt);
  assert.ok(!("kataDays" in s)); // history stays off the everyday paths, like completions
});

test("validateState: at most 5 ACTIVE kata — inactive ones don't count", () => {
  const kata = (n, active = true) =>
    Array.from({ length: n }, (_, i) => ({ id: `k${i}${active}`, title: `k ${i}`, active }));
  assert.match(db.validateState({ kata: kata(6) }), /at most 5 kata can be active/);
  assert.equal(db.validateState({ kata: kata(5) }), null);
  assert.equal(db.validateState({ kata: [...kata(5), ...kata(4, false)] }), null);
  // absent `active` counts as active (the schema default)
  assert.ok(
    db.validateState({ kata: Array.from({ length: 6 }, (_, i) => ({ id: `x${i}`, title: "t" })) }),
  );
});

test("validateState: kata shape and duplicate ids are named", () => {
  assert.match(db.validateState({ kata: [{ title: "no id" }] }), /kata needs an id/);
  assert.match(db.validateState({ kata: [{ id: "k", title: "  " }] }), /kata needs a title/);
  assert.match(db.validateState({ kata: [{ id: "k", title: "t", active: "no" }] }), /kata.active/);
  assert.match(
    db.validateState({
      kata: [
        { id: "dup", title: "a" },
        { id: "dup", title: "b" },
      ],
    }),
    /duplicate kata id "dup"/,
  );
  assert.equal(db.validateState({ kata: [{ id: "k", title: "t", active: 1 }] }), null);
});

test("validateState: kataDays rows need a valid day and id arrays", () => {
  assert.match(db.validateState({ kataDays: "nope" }), /kataDays must be an array/);
  assert.match(
    db.validateState({ kataDays: [{ day: "2026-02-30", activeIds: [], honoredIds: [] }] }),
    /valid day/,
  );
  assert.match(
    db.validateState({ kataDays: [{ day: "2026-06-23", activeIds: "x", honoredIds: [] }] }),
    /arrays/,
  );
  assert.equal(
    db.validateState({ kataDays: [{ day: "2026-06-23", activeIds: ["a"], honoredIds: ["a"] }] }),
    null,
  );
});

test("honor toggle: completions row + day snapshot, undo retracts both", () => {
  db.resetAll();
  db.putState({ kata: KATA });
  const before = db.getState().rev;

  let s = db.setKataHonored("kata-a", true, "2026-06-23T08:00:00Z");
  assert.equal(s.rev, before + 1);
  assert.ok(!("completions" in s)); // the honor response stays slim
  let full = db.getFullState();
  assert.deepEqual(
    full.completions.map((c) => [c.kind, c.refId, c.day]),
    [["kata", "kata-a", "2026-06-23"]],
  );
  // first honor of the day snapshotted the ACTIVE set (kata-c is retired)
  assert.deepEqual(full.kataDays, [
    { day: "2026-06-23", activeIds: ["kata-a", "kata-b"], honoredIds: ["kata-a"] },
  ]);

  // re-honoring the same day is a no-op for the log (UNIQUE) and the cache
  db.setKataHonored("kata-a", true, "2026-06-23T09:00:00Z");
  assert.equal(db.getFullState().completions.length, 1);
  assert.deepEqual(db.getActivitySummary().totals, { tasks: 0, steps: 0, kata: 1 });

  const today = db.getKataToday("2026-06-23");
  assert.deepEqual(
    today.items.map((i) => [i.id, i.honoredToday]),
    [
      ["kata-a", true],
      ["kata-b", false],
    ],
  );
  assert.deepEqual(today.today, { honored: 1, total: 2, clean: false });

  // honoring the rest makes the day clean
  db.setKataHonored("kata-b", true, "2026-06-23T21:00:00Z");
  assert.deepEqual(db.getKataToday("2026-06-23").today, { honored: 2, total: 2, clean: true });

  // undo removes only that day's credit — and the snapshot survives
  s = db.setKataHonored("kata-b", false, "2026-06-23T22:00:00Z");
  full = db.getFullState();
  assert.equal(full.completions.length, 1);
  assert.deepEqual(full.kataDays[0].honoredIds, ["kata-a"]);
  assert.deepEqual(full.kataDays[0].activeIds, ["kata-a", "kata-b"]); // snapshot intact
  assert.deepEqual(db.getActivitySummary().totals, { tasks: 0, steps: 0, kata: 1 });
});

test("honor toggle: the day's snapshot wins when the active set changes mid-day", () => {
  db.resetAll();
  db.putState({ kata: KATA });
  db.setKataHonored("kata-a", true, "2026-06-23T08:00:00Z");
  db.setKataHonored("kata-b", true, "2026-06-23T09:00:00Z");
  // clean by the morning snapshot…
  assert.deepEqual(db.getKataToday("2026-06-23").today, { honored: 2, total: 2, clean: true });
  // …then a third form activates at 11 pm — the snapshot doesn't move
  db.putState({ kata: KATA.map((k) => ({ ...k, active: true })) });
  const t = db.getKataToday("2026-06-23");
  assert.deepEqual(t.today, { honored: 2, total: 3, clean: true }); // snapshot wins
  assert.equal(t.items.length, 3);
});

test("a PUT that retires a kata mid-day intersects TODAY's snapshot; history stays", () => {
  db.resetAll();
  db.putState({ kata: KATA });
  // yesterday's ledger row — history must keep the yardstick it was measured against
  db.setKataHonored("kata-a", true, "2026-06-22T08:00:00Z");
  db.setKataHonored("kata-b", true, "2026-06-22T09:00:00Z");
  // today (the real local day — reconcile only ever touches today's row):
  // honor one of two, then retire the OTHER mid-day
  db.setKataHonored("kata-a", true);
  db.putState({ kata: KATA.map((k) => (k.id === "kata-b" ? { ...k, active: false } : k)) });
  const today = new Date().toISOString().slice(0, 10); // TZ pinned to UTC above
  const rows = db.getFullState().kataDays;
  assert.deepEqual(
    rows.find((r) => r.day === today),
    { day: today, activeIds: ["kata-a"], honoredIds: ["kata-a"] },
  );
  // the retire can no longer make clean unreachable — kata-a alone holds the day,
  // and the banner's "{honored} of {total}" matches what's achievable
  assert.deepEqual(db.getKataToday(today).today, { honored: 1, total: 1, clean: true });
  // …while yesterday's row didn't move
  assert.deepEqual(rows.find((r) => r.day === "2026-06-22").activeIds, ["kata-a", "kata-b"]);

  // a delete-by-absence reconciles the same way, and an emptied snapshot drops
  // the row so a later honor re-snapshots fresh instead of judging against []
  db.putState({ kata: KATA.filter((k) => k.id === "kata-c").map((k) => ({ ...k, active: true })) });
  assert.equal(
    db.getFullState().kataDays.find((r) => r.day === today),
    undefined,
  );
  db.setKataHonored("kata-c", true);
  assert.deepEqual(
    db.getFullState().kataDays.find((r) => r.day === today),
    { day: today, activeIds: ["kata-c"], honoredIds: ["kata-c"] },
  );
});

test("un-honoring the day's last kata drops the ledger row — the next honor re-snapshots", () => {
  db.resetAll();
  db.putState({ kata: KATA });
  db.setKataHonored("kata-a", true, "2026-06-23T08:00:00Z");
  assert.equal(db.getFullState().kataDays.length, 1);
  db.setKataHonored("kata-a", false, "2026-06-23T09:00:00Z");
  assert.deepEqual(db.getFullState().kataDays, []); // row gone, not honoredIds: []
  // the active set changes while nothing is honored…
  db.putState({ kata: KATA.map((k) => ({ ...k, active: true })) });
  // …and the day's next FIRST honor snapshots the fresh set, not the stale one
  db.setKataHonored("kata-c", true, "2026-06-23T10:00:00Z");
  assert.deepEqual(db.getFullState().kataDays, [
    { day: "2026-06-23", activeIds: ["kata-a", "kata-b", "kata-c"], honoredIds: ["kata-c"] },
  ]);
});

test("honoring a retired or unknown kata throws (nothing written)", () => {
  db.resetAll();
  db.putState({ kata: KATA });
  const before = db.getFullState();
  assert.throws(() => db.setKataHonored("kata-c", true), /not active/);
  assert.throws(() => db.setKataHonored("ghost", true), /not found/);
  assert.deepEqual(db.getFullState(), before);
});

test("export → import round-trips kata AND the honor ledger", () => {
  db.resetAll();
  db.putState({ kata: KATA });
  db.setKataHonored("kata-a", true, "2026-06-22T08:00:00Z");
  db.setKataHonored("kata-b", true, "2026-06-22T09:00:00Z");
  db.setKataHonored("kata-a", true, "2026-06-23T08:00:00Z");
  const exported = db.getFullState();
  assert.equal(exported.kataDays.length, 2);
  db.resetAll();
  assert.deepEqual(db.getFullState().kataDays, []);
  const restored = db.importAll(exported);
  assert.deepEqual(restored.kataDays, exported.kataDays);
  assert.deepEqual(restored.kata, exported.kata);
  assert.deepEqual(db.getActivitySummary().totals, { tasks: 0, steps: 0, kata: 3 });
});

test("everyday PUT never touches the honor ledger (even an explicit kataDays key)", () => {
  db.resetAll();
  db.putState({ kata: KATA });
  db.setKataHonored("kata-a", true, "2026-06-23T08:00:00Z");
  const before = db.getFullState().kataDays;
  const s = db.putState({ kata: KATA, kataDays: [] });
  assert.ok(!("kataDays" in s));
  assert.deepEqual(db.getFullState().kataDays, before);
});

test("a kata vanishing from a PUT is trashed; restore brings it back intact", () => {
  db.resetAll();
  db.putState({ kata: KATA });
  const s = db.putState({ kata: KATA.slice(0, 2) });
  assert.deepEqual(
    s.trashed.map((r) => [r.kind, r.title]),
    [["kata", "my own form"]],
  );
  const [row] = db.listTrash();
  assert.equal(row.kind, "kata");
  assert.equal(row.counts, null); // nothing to count on a lone kata
  const { state, restored } = db.restoreTrash(row.id);
  assert.deepEqual(restored, { id: row.id, kind: "kata", title: "my own form", remapped: false });
  const back = state.kata.find((k) => k.id === "kata-c");
  assert.equal(back.note, "custom, no builtin");
  assert.equal(back.active, false);
});

test("restoring a kata into a full dōjō brings it back retired, not invalid", () => {
  db.resetAll();
  const five = Array.from({ length: 5 }, (_, i) => ({ id: `k${i}`, title: `form ${i}` }));
  // "gone" is active alongside four others…
  db.putState({ kata: [{ id: "gone", title: "the sixth", active: true }, ...five.slice(0, 4)] });
  // …then it vanishes and the dōjō refills to 5 active before the undo
  db.putState({ kata: five });
  const row = db.listTrash().find((r) => r.title === "the sixth");
  const { state } = db.restoreTrash(row.id);
  const back = state.kata.find((k) => k.title === "the sixth");
  assert.equal(back.active, false); // 5 already active — it returns retired
  assert.equal(db.validateState(state), null); // the next PUT can't get stranded
});

test("restoreTrash: a recreated kata id forces a remap", () => {
  db.resetAll();
  db.putState({ kata: KATA });
  db.putState({ kata: KATA.slice(1) }); // kata-a vanishes
  db.putState({ kata: [{ id: "kata-a", title: "rebuilt" }, ...KATA.slice(1)] });
  const row = db.listTrash().find((r) => r.kind === "kata");
  const { state, restored } = db.restoreTrash(row.id);
  assert.equal(restored.remapped, true);
  const back = state.kata.find((k) => k.title === "greyscale phone");
  assert.notEqual(back.id, "kata-a");
  assert.match(back.id, /^kata_/);
});

test("resetAll clears kata and the honor ledger too", () => {
  db.putState({ kata: KATA.slice(0, 1) });
  db.setKataHonored("kata-a", true);
  const s = db.resetAll();
  assert.deepEqual(s.kata, []);
  assert.deepEqual(db.getFullState().kataDays, []);
  assert.deepEqual(db.getActivitySummary().totals, { tasks: 0, steps: 0, kata: 0 });
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
  assert.deepEqual(db.getActivitySummary().totals, { tasks: 1, steps: 1, kata: 0 });

  db.replaceCompletions([{ day: "2026-06-19", kind: "task", refId: "imp" }]);
  assert.deepEqual(db.getActivitySummary().totals, { tasks: 1, steps: 0, kata: 0 });

  db.resetAll();
  const a = db.getActivitySummary();
  assert.equal(a.byDay.size, 0);
  assert.deepEqual(a.totals, { tasks: 0, steps: 0, kata: 0 });
});
