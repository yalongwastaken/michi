// markdown.test.js — Markdown export/sync: render, parse, plan, apply.
// Uses a throwaway DB file via MICHI_DB (set before importing db.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";

const DB = join(tmpdir(), `michi-md-test-${process.pid}.db`);
process.env.MICHI_DB = DB;

const db = await import("./db.js");
const md = await import("./markdown.js");

test.after(() => {
  for (const ext of ["", "-wal", "-shm"]) {
    try {
      rmSync(DB + ext);
    } catch {
      /* ignore */
    }
  }
});

// a small but full-featured model: every attribute token gets exercised
const SEED = {
  roadmaps: [
    { id: "rm1", title: "Embedded", targetDate: "2026-09-01", stepMinutes: 45, position: 0 },
    { id: "rm2", title: "Old Track", archived: true, position: 1 },
  ],
  milestones: [
    { id: "ms1", roadmapId: "rm1", title: "Basics", position: 0 },
    { id: "ms2", roadmapId: "rm2", title: "Hidden", position: 0 },
  ],
  steps: [
    {
      id: "st1",
      milestoneId: "ms1",
      title: "GPIO",
      status: "done",
      position: 0,
      resourceUrl: "https://x.dev/gpio",
      notes: "mind the pull-up on pin 4",
      doneAt: "2026-07-01T10:00:00.000Z",
    },
    { id: "st2", milestoneId: "ms1", title: "UART", status: "todo", position: 1 },
    { id: "st3", milestoneId: "ms2", title: "Secret step", status: "todo", position: 0 },
  ],
  projects: [
    {
      id: "pj1",
      title: "Blinky",
      status: "active",
      repoUrl: "https://github.com/x/blinky",
      summary: "An LED that blinks",
      position: 0,
      roadmapId: "rm1",
    },
  ],
  tasks: [
    {
      id: "t1",
      title: "Read datasheet",
      status: "doing",
      due: "2026-07-14",
      estMin: 30,
      stepId: "st1",
      projectId: "pj1",
      recurrence: "daily",
      position: 0,
      notes: "left off at §3\nre-read the timing diagram",
    },
  ],
  kata: [
    {
      id: "ka1",
      title: "greyscale phone",
      builtinId: "greyscale-phone",
      active: true,
      position: 0,
      note: "turn it off before bed",
    },
    { id: "ka2", title: "my custom form", active: false, position: 1 },
  ],
  completions: [
    { day: "2026-07-01", kind: "step", refId: "st1" },
    { day: "2026-07-02", kind: "task", refId: "t1" },
  ],
  kataDays: [{ day: "2026-07-02", activeIds: ["ka1"], honoredIds: ["ka1"] }],
};

test("export renders anchors, attribute tokens, and the prompt header", () => {
  db.importAll(SEED);
  const state = {
    ...db.getFullState(),
    settings: {
      dailyGoal: 3,
      dailyMinutes: 60,
      intensity: "steady",
      weeklyGoal: 15,
      weeklyActiveDays: 5,
    },
  };
  const out = md.renderExport(state, "2026-07-13");
  // header: a conversational coach prompt carrying today + goals + the format rules
  assert.match(out, /Today is 2026-07-13/);
  assert.match(out, /"Steady" intensity/);
  assert.match(out, /daily goal is 3 completions in about 60 minutes/);
  assert.match(out, /aiming for 15 completions across 5 active days/);
  assert.match(out, /AREN'T tracked here/); // coaches ad-hoc goals, not just roadmaps
  assert.match(out, /OMIT the anchor/);
  assert.match(out, /# michi snapshot · 2026-07-13/);
  // snapshot: anchors and only-the-present attribute tokens
  assert.match(out, /## Roadmap: Embedded \{#rm1\}/);
  assert.match(out, /target: 2026-09-01 · 50% done/);
  assert.match(out, /### Milestone: Basics \{#ms1\}/);
  assert.match(
    out,
    /- \[x\] GPIO \{#st1\} ~45m https:\/\/x\.dev\/gpio\n {2}> mind the pull-up on pin 4/,
  );
  assert.match(out, /- \[ \] UART \{#st2\} ~45m/);
  assert.match(out, /## Project: Blinky \{#pj1\}/);
  assert.match(out, /status: active · repo: https:\/\/github\.com\/x\/blinky · roadmap:#rm1/);
  assert.match(out, /An LED that blinks/);
  // multi-line notes: one `> ` line per notes line, right under the item
  assert.match(
    out,
    /- \[~\] Read datasheet \{#t1\} due:2026-07-14 ~30m step:#st1 project:#pj1 every:daily\n {2}> left off at §3\n {2}> re-read the timing diagram/,
  );
  // archived roadmap: marker present, its tree omitted
  assert.match(out, /## Roadmap: Old Track \{#rm2\}\narchived/);
  assert.doesNotMatch(out, /Secret step/);
  // kata: checkbox = ACTIVE (not honoring), form token + note ride along
  assert.match(out, /`## Kata` are daily forms/); // documented in the prompt header
  assert.match(
    out,
    /## Kata\n- \[x\] greyscale phone \{#ka1\} form:greyscale-phone\n {2}> turn it off before bed\n- \[ \] my custom form \{#ka2\}/,
  );
});

test("parse round-trips an export: no creates, no updates, no warnings", () => {
  const state = db.getFullState();
  const parsed = md.parseSync(md.renderExport(state, "2026-07-13"));
  assert.deepEqual(parsed.warnings, []);
  const plan = md.planSync(parsed, state);
  assert.deepEqual(plan.warnings, []);
  assert.deepEqual(plan.updates, []);
  for (const items of Object.values(plan.creates)) {
    assert.deepEqual(items, []);
  }
});

test("a project summary starting with '> ' round-trips instead of parsing as a blockquote", () => {
  const state = {
    roadmaps: [],
    milestones: [],
    steps: [],
    projects: [
      { id: "pq", title: "Quoted", status: "idea", summary: "> ship the MVP first", position: 0 },
    ],
    tasks: [],
    settings: {},
  };
  const out = md.renderExport(state, "2026-07-13");
  assert.match(out, /^\\> ship the MVP first$/m); // escaped on the way out
  const parsed = md.parseSync(out);
  assert.equal(parsed.projects[0].summary, "> ship the MVP first"); // unescaped on the way back
  assert.ok(!parsed.warnings.some((w) => /skipped line/.test(w)));
  // …and the round-trip is a no-op sync, not a perpetual warning
  const plan = md.planSync(parsed, { ...state, completions: [] });
  assert.deepEqual(plan.updates, []);
});

test("a fenced reply is unwrapped", () => {
  const parsed = md.parseSync("Here you go!\n```markdown\n## Tasks\n- [ ] fenced task ~15m\n```\n");
  assert.equal(parsed.tasks.length, 1);
  assert.equal(parsed.tasks[0].title, "fenced task");
  assert.equal(parsed.tasks[0].estMin, 15);
  assert.equal(parsed.tasks[0].id, null);
});

test("pasting a full export back skips the prompt header without warnings", () => {
  const parsed = md.parseSync(md.renderExport(db.getFullState(), "2026-07-13"));
  assert.deepEqual(parsed.warnings, []);
  assert.equal(parsed.roadmaps.length, 2);
  assert.equal(parsed.tasks.length, 1);
});

test("a new roadmap with milestones and steps creates the full tree", () => {
  const state = { roadmaps: [], milestones: [], steps: [], projects: [], tasks: [] };
  const plan = md.planSync(
    md.parseSync(
      [
        "## Roadmap: Rust",
        "target: 2026-12-01",
        "### Milestone: Ownership",
        "- [ ] Read the book ch4",
        "- [~] Borrow checker katas https://exercism.org/rust",
      ].join("\n"),
    ),
    state,
  );
  assert.deepEqual(plan.updates, []);
  assert.equal(plan.creates.roadmaps.length, 1);
  const rm = plan.creates.roadmaps[0];
  assert.equal(rm.targetDate, "2026-12-01");
  assert.equal(rm.position, 0);
  assert.ok(rm.createdAt);
  const ms = plan.creates.milestones[0];
  assert.equal(ms.roadmapId, rm.id); // child resolved to the parent created above
  assert.equal(plan.creates.steps.length, 2);
  assert.deepEqual(
    plan.creates.steps.map((s) => s.milestoneId),
    [ms.id, ms.id],
  );
  assert.deepEqual(
    plan.creates.steps.map((s) => s.position),
    [0, 1], // doc order, after (empty) existing siblings
  );
  assert.equal(plan.creates.steps[1].status, "doing");
  assert.equal(plan.creates.steps[1].resourceUrl, "https://exercism.org/rust");
});

test("update touches only the fields present on the line", () => {
  const state = {
    roadmaps: [],
    milestones: [],
    steps: [],
    projects: [],
    tasks: [
      {
        id: "t1",
        title: "Old title",
        status: "todo",
        due: "2026-07-14",
        estMin: 30,
        notes: "keep me",
        position: 5,
        doneAt: null,
      },
    ],
  };
  const plan = md.planSync(md.parseSync("## Tasks\n- [x] New title {#t1} due:2026-07-15\n"), state);
  assert.equal(plan.updates.length, 1);
  const u = plan.updates[0];
  assert.equal(u.kind, "task");
  assert.equal(u.id, "t1");
  assert.deepEqual(u.changes.title, { from: "Old title", to: "New title" });
  assert.deepEqual(u.changes.due, { from: "2026-07-14", to: "2026-07-15" });
  assert.deepEqual(u.changes.status, { from: "todo", to: "done" });
  assert.ok(u.changes.doneAt.to); // done → stamped
  // estMin/notes/position weren't on the line — untouched
  assert.ok(!("estMin" in u.changes));
  assert.ok(!("notes" in u.changes));
  assert.ok(!("position" in u.changes));
});

test("marking done → doneAt stamped; back to todo → cleared; same status → no update", () => {
  const state = {
    roadmaps: [],
    milestones: [],
    steps: [],
    projects: [],
    tasks: [{ id: "td", title: "T", status: "done", doneAt: "2026-07-01T00:00:00.000Z" }],
  };
  const undo = md.planSync(md.parseSync("## Tasks\n- [ ] T {#td}\n"), state);
  assert.deepEqual(undo.updates[0].changes.doneAt, { from: "2026-07-01T00:00:00.000Z", to: null });
  const same = md.planSync(md.parseSync("## Tasks\n- [x] T {#td}\n"), state);
  assert.deepEqual(same.updates, []); // nothing actually changed
});

test("an unknown anchor becomes a create plus a warning", () => {
  const state = { roadmaps: [], milestones: [], steps: [], projects: [], tasks: [] };
  const plan = md.planSync(md.parseSync("## Tasks\n- [ ] Task X {#ghost}\n"), state);
  assert.equal(plan.creates.tasks.length, 1);
  assert.notEqual(plan.creates.tasks[0].id, "ghost"); // never adopt an invented id
  assert.ok(plan.warnings.some((w) => /unknown id "ghost"/.test(w)));
});

test("an invalid date warns and is dropped — no crash, task still lands", () => {
  const parsed = md.parseSync("## Tasks\n- [ ] T due:2026-99-99\n- [ ] R due:2026-02-30\n");
  assert.equal(parsed.tasks.length, 2);
  assert.equal(parsed.tasks[0].due, undefined);
  assert.equal(parsed.tasks[1].due, undefined); // rollover dates rejected too
  assert.ok(parsed.warnings.some((w) => /invalid due date "2026-99-99"/.test(w)));
});

test("a task can reference a step created in the same doc (via its doc anchor)", () => {
  const state = { roadmaps: [], milestones: [], steps: [], projects: [], tasks: [] };
  const plan = md.planSync(
    md.parseSync(
      [
        "## Roadmap: R",
        "### Milestone: M",
        "- [ ] New step {#tmp_step}",
        "## Tasks",
        "- [ ] Do it step:#tmp_step",
        "- [ ] Broken link step:#nowhere",
      ].join("\n"),
    ),
    state,
  );
  const step = plan.creates.steps[0];
  assert.notEqual(step.id, "tmp_step"); // fresh id, doc anchor remapped
  assert.equal(plan.creates.tasks[0].stepId, step.id);
  // an unresolvable ref is dropped (a dangling id would fail validation later)
  assert.equal(plan.creates.tasks[1].stepId, null);
  assert.ok(plan.warnings.some((w) => /unknown step "#nowhere"/.test(w)));
});

test("unknown lines warn (capped), and never crash the parse", () => {
  const junk = Array.from({ length: 30 }, (_, i) => `mystery prose line ${i}`);
  const parsed = md.parseSync(["## Tasks", "- [ ] real task", ...junk].join("\n"));
  assert.equal(parsed.tasks.length, 1);
  assert.equal(parsed.warnings.length, 11); // 10 + the "…and N more" summary
  assert.match(parsed.warnings.at(-1), /and 20 more/);
});

test("applySync merges creates + updates atomically and preserves completions", () => {
  const before = db.importAll(SEED);
  const result = md.applySync(
    md.parseSync(
      ["## Tasks", "- [x] Read datasheet {#t1} due:2026-07-14", "- [ ] Solder headers ~20m"].join(
        "\n",
      ),
    ),
  );
  assert.deepEqual(result.applied.createdCounts, {
    roadmaps: 0,
    milestones: 0,
    steps: 0,
    projects: 0,
    tasks: 1,
    kata: 0,
  });
  assert.equal(result.applied.updatedCounts.tasks, 1);
  const t1 = result.state.tasks.find((t) => t.id === "t1");
  assert.equal(t1.status, "done");
  assert.ok(t1.doneAt);
  assert.equal(t1.estMin, 30); // absent from the line → untouched
  assert.ok(result.state.tasks.some((t) => t.title === "Solder headers" && t.estMin === 20));
  // history untouched: sync writes NO completion rows (in-app check-offs own them)
  assert.deepEqual(result.state.completions, before.completions);
});

test("applySync throws with a clear message and writes nothing when the merge is invalid", () => {
  db.importAll(SEED);
  const before = db.getFullState();
  // hand-built parsed doc: a milestone whose roadmapIndex points at nothing, so the
  // prepared row has no roadmapId — validateState must catch it before importAll
  const parsed = {
    roadmaps: [],
    milestones: [{ id: null, title: "Orphan", roadmapIndex: 0 }],
    steps: [],
    projects: [],
    tasks: [],
    warnings: [],
  };
  assert.throws(() => md.applySync(parsed), /invalid state/);
  assert.deepEqual(db.getFullState(), before); // nothing was written
});

test("a token-like title round-trips exactly (anchored two-mode grammar)", () => {
  const state = {
    roadmaps: [],
    milestones: [],
    steps: [],
    projects: [],
    tasks: [
      {
        id: "tk1",
        title: "read ~30m of clock docs",
        status: "todo",
        estMin: 45,
        position: 0,
        doneAt: null,
      },
    ],
  };
  const parsed = md.parseSync(md.renderExport(state, "2026-07-13"));
  assert.deepEqual(parsed.warnings, []);
  assert.equal(parsed.tasks[0].title, "read ~30m of clock docs"); // no token eaten
  assert.equal(parsed.tasks[0].estMin, 45); // the real token, after the anchor
  const plan = md.planSync(parsed, state);
  assert.deepEqual(plan.warnings, []);
  assert.deepEqual(plan.updates, []);
  for (const items of Object.values(plan.creates)) {
    assert.deepEqual(items, []);
  }
});

test("anchored line: title before the anchor is verbatim, tokens read only after it", () => {
  const parsed = md.parseSync("## Tasks\n- [ ] read ~30m of docs {#t1} ~45m due:2026-07-20\n");
  assert.deepEqual(parsed.warnings, []);
  const t = parsed.tasks[0];
  assert.equal(t.title, "read ~30m of docs"); // the mid-title ~30m is NOT a token
  assert.equal(t.estMin, 45);
  assert.equal(t.due, "2026-07-20");
  // non-token words in the tail are dropped with a warning, never spliced back in
  const junk = md.parseSync("## Tasks\n- [ ] Fix bug {#t1} urgently due:2026-07-20\n");
  assert.equal(junk.tasks[0].title, "Fix bug");
  assert.equal(junk.tasks[0].due, "2026-07-20");
  assert.ok(junk.warnings.some((w) => /text after anchor ignored/.test(w)));
});

test("anchor-less line: tokens scanned from the right, mid-title tokens stay put", () => {
  const parsed = md.parseSync(
    ["## Tasks", "- [ ] read ~30m of clock docs", "- [ ] Slab allocator ~90m due:2026-07-20"].join(
      "\n",
    ),
  );
  assert.equal(parsed.tasks[0].title, "read ~30m of clock docs"); // scan stopped at "docs"
  assert.equal(parsed.tasks[0].estMin, undefined);
  assert.equal(parsed.tasks[1].title, "Slab allocator"); // trailing tokens parsed
  assert.equal(parsed.tasks[1].estMin, 90);
  assert.equal(parsed.tasks[1].due, "2026-07-20");
});

test("heading text after the anchor is ignored with a warning, never parsed", () => {
  const parsed = md.parseSync("## Roadmap: R {#rm1} target: 2026-01-01\n");
  assert.equal(parsed.roadmaps[0].title, "R");
  assert.equal(parsed.roadmaps[0].targetDate, undefined);
  assert.ok(parsed.warnings.some((w) => /text after anchor ignored/.test(w)));
});

test("duplicate anchors merge per-field — preview and apply agree, with a warning", () => {
  db.importAll(SEED);
  const parsed = md.parseSync(
    [
      "## Tasks",
      "- [~] Read datasheet {#t1} due:2026-07-20",
      "- [x] Read datasheet {#t1} ~55m",
    ].join("\n"),
  );
  const plan = md.planSync(parsed, db.getFullState());
  assert.equal(plan.updates.length, 1); // one merged update, not one-per-line
  const u = plan.updates[0];
  assert.deepEqual(u.changes.due, { from: "2026-07-14", to: "2026-07-20" });
  assert.deepEqual(u.changes.estMin, { from: 30, to: 55 });
  assert.equal(u.changes.status.to, "done");
  assert.ok(plan.warnings.some((w) => /duplicate anchor \{#t1\} — lines merged/.test(w)));
  const t1 = md.applySync(parsed).state.tasks.find((t) => t.id === "t1");
  assert.equal(t1.due, "2026-07-20"); // the first line's change survived apply
  assert.equal(t1.estMin, 55);
  assert.equal(t1.status, "done");
});

test("an anchor-less heading matches an existing item by title — no duplicate, no re-parent", () => {
  db.importAll(SEED);
  const result = md.applySync(
    md.parseSync(["## Roadmap: Embedded", "### Milestone: Basics {#ms1}", "- [ ] SPI"].join("\n")),
  );
  // "Embedded" was reused, not duplicated, and ms1 stayed under rm1
  assert.equal(result.state.roadmaps.filter((r) => r.title === "Embedded").length, 1);
  assert.equal(result.state.milestones.find((m) => m.id === "ms1").roadmapId, "rm1");
  assert.ok(result.state.steps.some((s) => s.title === "SPI" && s.milestoneId === "ms1"));
  assert.ok(result.warnings.some((w) => /matched "Embedded" by title/.test(w)));
});

test("milestone headings match by title within their roadmap; ambiguity creates instead", () => {
  db.importAll(SEED);
  const plan = md.planSync(
    md.parseSync("## Roadmap: Embedded\n### Milestone: basics\n- [x] UART {#st2}\n"),
    db.getFullState(),
  );
  assert.deepEqual(plan.creates.roadmaps, []);
  assert.deepEqual(plan.creates.milestones, []); // "basics" ≈ Basics under the same roadmap
  const st = plan.updates.find((u) => u.kind === "step" && u.id === "st2");
  assert.equal(st.changes.status.to, "done");
  assert.ok(!("milestoneId" in st.changes)); // no re-parent
  // two same-titled roadmaps → ambiguous → create a fresh one, with a warning
  const two = {
    roadmaps: [
      { id: "a", title: "Dup", position: 0 },
      { id: "b", title: "Dup", position: 1 },
    ],
    milestones: [],
    steps: [],
    projects: [],
    tasks: [],
  };
  const amb = md.planSync(md.parseSync("## Roadmap: Dup\n"), two);
  assert.equal(amb.creates.roadmaps.length, 1);
  assert.ok(amb.warnings.some((w) => /2 roadmaps titled "Dup"/.test(w)));
});

test("re-applying the same reply is idempotent — zero creates, zero updates", () => {
  db.importAll(SEED);
  // a realistic mixed reply: a brand-new roadmap tree, new tasks, and anchored edits
  const doc = [
    "## Roadmap: Kernel",
    "target: 2026-12-01",
    "### Milestone: Memory",
    "- [ ] Read the slab notes ~40m",
    "- [~] Page tables lab https://kernel.org/lab",
    "## Tasks",
    "- [x] Read datasheet {#t1} due:2026-07-15",
    "- [ ] Order jumper wires ~10m",
    "- [ ] Flash bootloader due:2026-07-20",
  ].join("\n");
  const parsed = md.parseSync(doc);
  const result = md.applySync(parsed);
  assert.deepEqual(result.applied.createdCounts, {
    roadmaps: 1,
    milestones: 1,
    steps: 2,
    projects: 0,
    tasks: 2,
    kata: 0,
  });
  assert.equal(result.applied.updatedCounts.tasks, 1);
  // careless re-paste of the SAME reply: everything resolves by title, nothing changes
  const again = md.planSync(parsed, result.state);
  assert.deepEqual(again.updates, []);
  for (const items of Object.values(again.creates)) {
    assert.deepEqual(items, []);
  }
  assert.ok(again.warnings.some((w) => /matched .* by title/.test(w)));
});

test("anchor-less step matches by title within its milestone — no cross-milestone match", () => {
  const state = {
    roadmaps: [{ id: "r1", title: "R", position: 0 }],
    milestones: [
      { id: "mA", roadmapId: "r1", title: "Alpha", position: 0 },
      { id: "mB", roadmapId: "r1", title: "Beta", position: 1 },
    ],
    steps: [
      { id: "sA", milestoneId: "mA", title: "Setup", status: "todo", position: 0, doneAt: null },
      { id: "sB", milestoneId: "mB", title: "Setup", status: "todo", position: 0, doneAt: null },
    ],
    projects: [],
    tasks: [],
  };
  const plan = md.planSync(
    md.parseSync("## Roadmap: R\n### Milestone: Beta\n- [x] Setup\n"),
    state,
  );
  // "Setup" exists in both milestones, but the doc placed it under Beta — only sB
  assert.deepEqual(plan.creates.steps, []);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].kind, "step");
  assert.equal(plan.updates[0].id, "sB");
  assert.equal(plan.updates[0].changes.status.to, "done");
  assert.ok(plan.warnings.some((w) => /step without an anchor matched "Setup" by title/.test(w)));
});

test("anchor-less task matches by title — updates due instead of duplicating", () => {
  const state = {
    roadmaps: [],
    milestones: [],
    steps: [],
    projects: [],
    tasks: [
      { id: "t9", title: "Pay rent", status: "todo", due: "2026-07-01", position: 0, doneAt: null },
    ],
  };
  const plan = md.planSync(md.parseSync("## Tasks\n- [ ] Pay rent due:2026-08-01\n"), state);
  assert.deepEqual(plan.creates.tasks, []);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].id, "t9");
  assert.deepEqual(plan.updates[0].changes, { due: { from: "2026-07-01", to: "2026-08-01" } });
  assert.ok(
    plan.warnings.some((w) => /task without an anchor matched "Pay rent" by title/.test(w)),
  );
});

test("ambiguous anchor-less task title — creates a new one, with a warning", () => {
  const state = {
    roadmaps: [],
    milestones: [],
    steps: [],
    projects: [],
    tasks: [
      { id: "d1", title: "Dup task", status: "todo", position: 0, doneAt: null },
      { id: "d2", title: "Dup task", status: "todo", position: 1, doneAt: null },
    ],
  };
  const plan = md.planSync(md.parseSync("## Tasks\n- [x] Dup task\n"), state);
  assert.deepEqual(plan.updates, []);
  assert.equal(plan.creates.tasks.length, 1);
  assert.ok(plan.warnings.some((w) => /2 tasks titled "Dup task"/.test(w)));
});

test("duplicate anchor-less lines in one doc merge into a single create", () => {
  const state = { roadmaps: [], milestones: [], steps: [], projects: [], tasks: [] };
  const plan = md.planSync(
    md.parseSync("## Tasks\n- [ ] Buy solder ~10m\n- [x] Buy solder due:2026-07-20\n"),
    state,
  );
  assert.equal(plan.creates.tasks.length, 1);
  const t = plan.creates.tasks[0];
  assert.equal(t.estMin, 10); // from the first line, kept
  assert.equal(t.due, "2026-07-20"); // from the second line, overlaid
  assert.equal(t.status, "done");
  assert.ok(t.doneAt);
  assert.ok(plan.warnings.some((w) => /duplicate task "Buy solder" — lines merged/.test(w)));
});

test("Project and Tasks headings clear roadmap context — stray milestones skip their subtree", () => {
  const afterProject = md.parseSync(
    [
      "## Roadmap: Embedded {#rm1}",
      "## Project: Blinky {#pj1}",
      "### Milestone: Stray",
      "- [ ] orphan step",
    ].join("\n"),
  );
  assert.deepEqual(afterProject.milestones, []);
  assert.deepEqual(afterProject.steps, []);
  assert.ok(afterProject.warnings.some((w) => /milestone outside a roadmap/.test(w)));
  assert.ok(afterProject.warnings.some((w) => /list item outside/.test(w)));
  // ...and a stray milestone after ## Tasks doesn't turn its steps into tasks
  const afterTasks = md.parseSync(
    ["## Tasks", "### Milestone: Stray", "- [ ] not a task"].join("\n"),
  );
  assert.deepEqual(afterTasks.tasks, []);
  assert.ok(afterTasks.warnings.some((w) => /milestone outside a roadmap/.test(w)));
});

test("items omitted from the doc are never deleted", () => {
  db.importAll(SEED);
  const result = md.applySync(md.parseSync("## Tasks\n- [ ] Only the new one\n"));
  // everything from the seed is still there, plus the new task
  assert.deepEqual(result.state.roadmaps.map((r) => r.id).sort(), ["rm1", "rm2"]);
  assert.equal(result.state.steps.length, 3);
  assert.ok(result.state.tasks.some((t) => t.id === "t1"));
  assert.equal(result.state.tasks.length, 2);
});

test("`> ` lines attach to the list item above as notes; blockquotes elsewhere are skipped", () => {
  const parsed = md.parseSync(
    [
      "> orphan at the top of the doc",
      "## Roadmap: R",
      "### Milestone: M",
      "- [ ] step with a note",
      "> check the errata first",
      "## Tasks",
      "- [ ] task with a long note",
      "> first line",
      "> second line",
      "- [ ] task without one",
    ].join("\n"),
  );
  assert.equal(parsed.steps[0].notes, "check the errata first");
  assert.equal(parsed.tasks[0].notes, "first line\nsecond line");
  assert.equal(parsed.tasks[1].notes, undefined); // absent, not "" — presence matters
  assert.ok(parsed.warnings.some((w) => /skipped line: "> orphan/.test(w)));
});

test("a blank line closes the notes window — and a project blockquote isn't a summary", () => {
  const late = md.parseSync("## Tasks\n- [ ] T\n\n> too late to attach\n");
  assert.equal(late.tasks[0].notes, undefined);
  assert.ok(late.warnings.some((w) => /skipped line: "> too late/.test(w)));
  // under a project heading a blockquote is skipped, never swallowed as summary
  const proj = md.parseSync("## Project: P\n> not a summary\n");
  assert.equal(proj.projects[0].summary, undefined);
  assert.ok(proj.warnings.some((w) => /skipped line: "> not a summary/.test(w)));
});

test("notes diff only when present in the doc, like every other field", () => {
  db.importAll(SEED);
  const state = db.getFullState();
  // no blockquote on the line → t1's existing notes stay untouched
  const absent = md.planSync(md.parseSync("## Tasks\n- [~] Read datasheet {#t1}\n"), state);
  assert.deepEqual(absent.updates, []);
  // a blockquote present → the whole notes value is compared and updated
  const changed = md.planSync(
    md.parseSync("## Tasks\n- [~] Read datasheet {#t1}\n> switched to the v2 datasheet\n"),
    state,
  );
  assert.equal(changed.updates.length, 1);
  assert.deepEqual(changed.updates[0].changes.notes, {
    from: "left off at §3\nre-read the timing diagram",
    to: "switched to the v2 datasheet",
  });
  // …and a new item lands with its note attached
  const created = md.planSync(md.parseSync("## Tasks\n- [ ] New task\n> with a note\n"), state);
  assert.equal(created.creates.tasks[0].notes, "with a note");
});

test("notes round-trip exactly: export → parse → plan = zero changes (multi-line incl.)", () => {
  db.importAll(SEED); // st1 carries single-line notes, t1 multi-line ones
  const state = db.getFullState();
  const parsed = md.parseSync(md.renderExport(state, "2026-07-13"));
  assert.deepEqual(parsed.warnings, []);
  assert.equal(parsed.tasks[0].notes, "left off at §3\nre-read the timing diagram");
  const plan = md.planSync(parsed, state);
  assert.deepEqual(plan.warnings, []);
  assert.deepEqual(plan.updates, []);
  for (const items of Object.values(plan.creates)) {
    assert.deepEqual(items, []);
  }
});

test("project roadmap link: parses, diffs, and resolves same-doc anchors", () => {
  db.importAll(SEED);
  const state = db.getFullState();
  // moving the link to another existing roadmap is a plain field update
  const moved = md.planSync(
    md.parseSync("## Project: Blinky {#pj1}\nstatus: active · roadmap:#rm2\n"),
    state,
  );
  assert.equal(moved.updates.length, 1);
  assert.deepEqual(moved.updates[0].changes.roadmapId, { from: "rm1", to: "rm2" });
  // an unknown ref drops the link with a warning instead of failing validation later
  const broken = md.planSync(
    md.parseSync("## Project: Blinky {#pj1}\nstatus: active · roadmap:#nowhere\n"),
    state,
  );
  assert.deepEqual(broken.updates, []); // link dropped → nothing left to change
  assert.ok(broken.warnings.some((w) => /project "Blinky" references unknown roadmap/.test(w)));
  // a new project can link a roadmap created in the same doc via its doc anchor
  const plan = md.planSync(
    md.parseSync(
      ["## Roadmap: Fresh Track {#tmp_rm}", "## Project: Fresh App", "roadmap:#tmp_rm"].join("\n"),
    ),
    state,
  );
  assert.equal(plan.creates.projects[0].roadmapId, plan.creates.roadmaps[0].id);
});

// ── kata sync ───────────────────────────────────────────────────────────────────

test("kata sync: create + retire via the checkbox; absent fields stay untouched", () => {
  db.importAll(SEED);
  const before = db.getFullState();
  const doc = [
    "## Kata",
    "- [ ] greyscale phone {#ka1}", // retire it (checkbox = active flag)
    "- [x] water before coffee form:water-first", // a new active form, with a note
    "> hydrate first",
  ].join("\n");
  const result = md.applySync(md.parseSync(doc));
  assert.equal(result.applied.updatedCounts.kata, 1);
  assert.equal(result.applied.createdCounts.kata, 1);
  const ka1 = result.state.kata.find((k) => k.id === "ka1");
  assert.equal(ka1.active, false);
  assert.equal(ka1.note, "turn it off before bed"); // no blockquote on the line → kept
  assert.equal(ka1.builtinId, "greyscale-phone"); // no form: token on the line → kept
  const fresh = result.state.kata.find((k) => k.title === "water before coffee");
  assert.match(fresh.id, /^kata_/);
  assert.equal(fresh.active, true);
  assert.equal(fresh.builtinId, "water-first");
  assert.equal(fresh.note, "hydrate first");
  // sync never writes honor history — the ledger and the log are untouched
  assert.deepEqual(result.state.kataDays, before.kataDays);
  assert.deepEqual(result.state.completions, before.completions);
  // a careless re-paste of the same reply changes nothing (title match, no dupes)
  const again = md.planSync(md.parseSync(doc), result.state);
  assert.deepEqual(again.updates, []);
  assert.deepEqual(again.creates.kata, []);
  assert.ok(again.warnings.some((w) => /kata without an anchor matched/.test(w)));
});

test("kata: an unknown anchor demotes to a create; anchor-less titles match", () => {
  db.importAll(SEED);
  const plan = md.planSync(
    md.parseSync("## Kata\n- [x] Ghost form {#nope}\n- [ ] my custom form\n"),
    db.getFullState(),
  );
  assert.equal(plan.creates.kata.length, 1);
  assert.notEqual(plan.creates.kata[0].id, "nope"); // never adopt an invented id
  assert.ok(plan.warnings.some((w) => /unknown id "nope"/.test(w)));
  assert.deepEqual(plan.updates, []); // ka2 matched by title and already retired
});

test("sync can activate a sixth (and beyond) kata — no cap", () => {
  db.importAll({
    kata: Array.from({ length: 5 }, (_, i) => ({ id: `f${i}`, title: `form ${i}` })),
  });
  const ok = md.applySync(md.parseSync("## Kata\n- [x] a sixth form\n"));
  assert.equal(ok.state.kata.length, 6);
  assert.equal(ok.state.kata.find((k) => k.title === "a sixth form").active, true);
});

test("preview never warns about a kata cap — there isn't one", () => {
  db.importAll({
    kata: Array.from({ length: 5 }, (_, i) => ({ id: `f${i}`, title: `form ${i}` })),
  });
  const plan = md.planSync(md.parseSync("## Kata\n- [x] a sixth form\n"), db.getFullState());
  assert.ok(!plan.warnings.some((w) => /activate|cap|at most/.test(w)), plan.warnings.join("; "));
});

test("kata checkbox: `[~]` counts as ACTIVE — doing is practicing, not retiring", () => {
  db.importAll(SEED); // ka1 is active
  const parsed = md.parseSync("## Kata\n- [~] greyscale phone {#ka1}\n");
  assert.deepEqual(parsed.warnings, []); // active-in-spirit, not worth a warning
  assert.equal(parsed.kata[0].active, true);
  // …so the line is a no-op against an already-active form, not a silent retire
  const plan = md.planSync(parsed, db.getFullState());
  assert.deepEqual(plan.updates, []);
});

test("an unknown form: id is kept verbatim — with a warning", () => {
  const parsed = md.parseSync("## Kata\n- [x] mystery form form:not-a-real-form\n");
  assert.equal(parsed.kata[0].builtinId, "not-a-real-form"); // never rewritten
  assert.ok(parsed.warnings.some((w) => /unknown form id "not-a-real-form"/.test(w)));
  // a library id passes quietly
  assert.deepEqual(md.parseSync("## Kata\n- [x] shutdown ritual form:shutdown\n").warnings, []);
});

test("project roadmap link applies end-to-end and stays idempotent", () => {
  db.importAll(SEED);
  const doc = "## Project: Blinky {#pj1}\nstatus: active · roadmap:#rm2\n";
  const result = md.applySync(md.parseSync(doc));
  assert.equal(result.state.projects.find((p) => p.id === "pj1").roadmapId, "rm2");
  // re-applying the same reply changes nothing
  const again = md.planSync(md.parseSync(doc), result.state);
  assert.deepEqual(again.updates, []);
});
