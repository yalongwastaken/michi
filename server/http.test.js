// http.test.js — integration tests over real HTTP. Boots the actual Express app
// (index.js exports it without listening when imported) on an ephemeral port with
// a throwaway MICHI_DB, then exercises the API the way the client does: routing,
// middleware (JSON limits, the origin guard), status codes and body shapes — the
// layer the unit tests can't see.
process.env.TZ = "UTC";
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";

const DB = join(tmpdir(), `michi-http-test-${process.pid}.db`);
process.env.MICHI_DB = DB; // must be set before index.js (→ db.js) is imported
const BACKUPS = join(tmpdir(), `michi-http-test-backups-${process.pid}`);
process.env.MICHI_BACKUPS = BACKUPS; // keep snapshot tests out of the real ./backups

const { app } = await import("./index.js");
const server = await new Promise((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s)); // port 0 → ephemeral
});
const base = `http://127.0.0.1:${server.address().port}`;

test.after(() => {
  server.close();
  for (const ext of ["", "-wal", "-shm"]) {
    try {
      rmSync(DB + ext);
    } catch {
      /* ignore */
    }
  }
  rmSync(BACKUPS, { recursive: true, force: true });
});

const api = (path, opts) => fetch(base + path, opts);
const send = (method, path, body, headers = {}) =>
  api(path, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

test("GET /api/health answers ok", async () => {
  const res = await api("/api/health");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test("GET /api/state has the unified shape — and no completions log", async () => {
  const res = await api("/api/state");
  assert.equal(res.status, 200);
  const s = await res.json();
  assert.equal(typeof s.rev, "number");
  for (const k of ["roadmaps", "milestones", "steps", "projects", "tasks"]) {
    assert.ok(Array.isArray(s[k]), `${k} should be an array`);
  }
  assert.equal(typeof s.profile, "object");
  assert.equal(typeof s.settings, "object");
  assert.ok(!("completions" in s)); // history is server-owned; /api/export ships it
});

test("PUT /api/state happy path: saves and bumps the rev", async () => {
  const before = await (await api("/api/state")).json();
  const res = await send("PUT", "/api/state", {
    rev: before.rev,
    tasks: [{ id: "t-put", title: "integration save" }],
  });
  assert.equal(res.status, 200);
  const s = await res.json();
  assert.equal(s.rev, before.rev + 1);
  assert.deepEqual(
    s.tasks.map((t) => t.id),
    ["t-put"],
  );
  assert.ok(!("completions" in s)); // write responses stay slim
  assert.deepEqual(s.trashed, []); // …but always carry the (empty) trash receipt
});

test("PUT /api/state with a stale rev → 409 carrying the fresh state", async () => {
  const cur = await (await api("/api/state")).json();
  const res = await send("PUT", "/api/state", {
    rev: cur.rev - 1, // stale: another tab saved since we loaded
    tasks: [{ id: "t-clobber", title: "should not land" }],
  });
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.ok(body.error);
  // the 409 hands back the current server state so the client can re-sync
  assert.equal(body.state.rev, cur.rev);
  assert.deepEqual(
    body.state.tasks.map((t) => t.id),
    ["t-put"],
  );
});

test("origin guard: cross-origin writes are rejected, same-origin/no-origin pass", async () => {
  // a malicious page elsewhere on the tailnet trying to wipe the DB
  const evil = await send("POST", "/api/reset", {}, { Origin: "http://evil.example" });
  assert.equal(evil.status, 403);
  const mangled = await send("POST", "/api/reset", {}, { Origin: "not a url" });
  assert.equal(mangled.status, 403);
  const survived = await (await api("/api/state")).json();
  assert.ok(survived.tasks.some((t) => t.id === "t-put")); // nothing was wiped
  // the app itself (Origin === Host) and non-browser tools (no Origin) both pass
  const sameOrigin = await send(
    "POST",
    "/api/tasks",
    { id: "t-origin", title: "same-origin write" },
    { Origin: base },
  );
  assert.equal(sameOrigin.status, 200);
  const noOrigin = await send("POST", "/api/tasks", { id: "t-curl", title: "curl-style write" });
  assert.equal(noOrigin.status, 200);
  // GETs are exempt (they don't mutate) — a cross-origin read isn't blocked here
  const read = await api("/api/state", { headers: { Origin: "http://evil.example" } });
  assert.equal(read.status, 200);
});

test("POST /api/complete toggles, and /api/today reflects it", async () => {
  const done = await send("POST", "/api/complete", { kind: "task", id: "t-put", done: true });
  assert.equal(done.status, 200);
  const s = await done.json();
  assert.equal(s.tasks.find((t) => t.id === "t-put").status, "done");
  assert.ok(!("completions" in s)); // the log itself never rides along

  let today = await (await api("/api/today")).json();
  assert.ok(today.doneToday.some((i) => i.id === "t-put"));
  assert.ok(!today.dueToday.some((i) => i.id === "t-put"));

  const undone = await send("POST", "/api/complete", { kind: "task", id: "t-put", done: false });
  assert.equal(undone.status, 200);
  today = await (await api("/api/today")).json();
  assert.ok(!today.doneToday.some((i) => i.id === "t-put"));
  assert.ok(today.dueToday.some((i) => i.id === "t-put")); // undated → back in the queue

  const missing = await send("POST", "/api/complete", { kind: "task", id: "ghost", done: true });
  assert.equal(missing.status, 404);
});

test("bad payloads get a 4xx, never a 500", async () => {
  // malformed JSON body
  const badJson = await send("POST", "/api/import", "{oops");
  assert.equal(badJson.status, 400);
  // pathological settings (validateState)
  const badSettings = await send("PUT", "/api/state", { settings: { streakFreezes: 1e9 } });
  assert.equal(badSettings.status, 400);
  assert.match((await badSettings.json()).error, /streakFreezes/);
  // oversized body — past the 5 mb JSON limit
  const huge = await send("PUT", "/api/state", {
    settings: { theme: "x".repeat(6 * 1024 * 1024) },
  });
  assert.equal(huge.status, 413);
  // a garbage ?day= falls back to the server-local today instead of 500ing
  for (const path of [
    "/api/today?day=2026-99-99",
    "/api/plan?day=garbage",
    "/api/momentum?day=x",
  ]) {
    const res = await api(path);
    assert.equal(res.status, 200, path);
    const body = await res.json();
    assert.match(body.day, /^\d{4}-\d{2}-\d{2}$/, path);
    assert.notEqual(body.day, "2026-99-99");
  }
});

test("GET /api/today: a negative ?limit falls back instead of slicing", async () => {
  const cur = await (await api("/api/state")).json();
  const put = await send("PUT", "/api/state", {
    rev: cur.rev,
    roadmaps: [{ id: "R", title: "Embedded", archived: false }],
    milestones: [{ id: "M", roadmapId: "R", title: "Basics", position: 0 }],
    steps: [{ id: "S", milestoneId: "M", title: "GPIO", status: "todo", position: 0 }],
    tasks: [{ id: "t-rt", title: "round-trip me" }],
  });
  assert.equal(put.status, 200);
  const today = await (await api("/api/today?limit=-1")).json();
  assert.equal(today.suggested.length, 1); // slice(0, -1) would have dropped it
  const capped = await (await api("/api/today?limit=0")).json();
  assert.equal(capped.suggested.length, 0); // 0 is a real cap, not "missing"
});

test("export → reset → import → export round-trips, completions included", async () => {
  // create real history first: complete the step so the log has a row
  const done = await send("POST", "/api/complete", { kind: "step", id: "S", done: true });
  assert.equal(done.status, 200);

  const expRes = await api("/api/export");
  assert.equal(expRes.status, 200);
  assert.match(expRes.headers.get("content-disposition") || "", /attachment/);
  const exported = await expRes.json();
  assert.ok(exported.completions.length >= 1); // export DOES carry history

  const reset = await send("POST", "/api/reset", {});
  assert.equal(reset.status, 200);
  const wiped = await (await api("/api/export")).json();
  assert.equal(wiped.completions.length, 0);
  assert.equal(wiped.tasks.length, 0);

  const imp = await send("POST", "/api/import", exported);
  assert.equal(imp.status, 200);
  assert.deepEqual((await imp.json()).completions, exported.completions);

  const reExported = await (await api("/api/export")).json();
  // the rev keeps counting across reset/import (it's a concurrency token, not data);
  // everything else must round-trip exactly — completions included
  const strip = ({ rev: _rev, ...rest }) => rest;
  assert.deepEqual(strip(reExported), strip(exported));
});

test("GET /api/digest?format=text renders the plain-text morning summary", async () => {
  const res = await api("/api/digest?format=text");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") || "", /text\/plain/);
  const text = await res.text();
  assert.match(text, /^Michi — /);
  const json = await (await api("/api/digest")).json(); // default stays JSON
  assert.equal(typeof json.text, "string");
});

test("GET /api/digest?mode=evening looks back; junk modes get a 400", async () => {
  const res = await api("/api/digest?mode=evening&format=text");
  assert.equal(res.status, 200);
  assert.match(await res.text(), /· evening/);
  const json = await (await api("/api/digest?mode=evening")).json();
  assert.equal(json.mode, "evening");
  assert.ok(Array.isArray(json.tomorrow));
  const bad = await api("/api/digest?mode=someday");
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /mode/);
});

test("backups: POST /api/backup snapshots, GET /api/backups lists newest first", async () => {
  const empty = await (await api("/api/backups")).json();
  assert.deepEqual(empty.items, []); // no folder yet — a calm empty list
  assert.equal(typeof empty.dir, "string");

  const res = await send("POST", "/api/backup", {});
  assert.equal(res.status, 200);
  const entry = await res.json();
  assert.match(entry.file, /^michi-\d{4}-\d{2}-\d{2}\.db$/);
  assert.ok(entry.sizeBytes > 0);
  assert.ok(!Number.isNaN(Date.parse(entry.mtime)));

  const list = await (await api("/api/backups")).json();
  assert.equal(list.items.length, 1); // a same-day re-run replaces, not duplicates
  assert.deepEqual(list.items[0], entry);
});

test("GET /api/export.md serves the Claude-ready markdown snapshot", async () => {
  const res = await api("/api/export.md");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") || "", /text\/markdown/);
  assert.match(
    res.headers.get("content-disposition") || "",
    /attachment; filename="michi-claude-\d{4}-\d{2}-\d{2}\.md"/,
  );
  const text = await res.text();
  assert.match(text, /# michi snapshot/);
  assert.match(text, /## Roadmap: Embedded \{#R\}/); // anchors ride along
});

test("POST /api/sync/preview dry-runs the plan without writing", async () => {
  const before = await (await api("/api/state")).json();
  const res = await send("POST", "/api/sync/preview", {
    markdown: "## Tasks\n- [ ] preview-only task ~15m\n",
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.creates.tasks.count, 1);
  assert.equal(body.creates.tasks.items[0].title, "preview-only task");
  assert.deepEqual(body.updates, []);
  const after = await (await api("/api/state")).json();
  assert.equal(after.rev, before.rev); // preview never writes
  assert.ok(!after.tasks.some((t) => t.title === "preview-only task"));
});

test("POST /api/sync/apply creates + updates; bad bodies get a 400", async () => {
  const res = await send("POST", "/api/sync/apply", {
    markdown: "## Tasks\n- [x] round-trip me {#t-rt}\n- [ ] synced task due:2026-07-14 ~20m\n",
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.applied.createdCounts.tasks, 1);
  assert.equal(body.applied.updatedCounts.tasks, 1);
  assert.equal(body.state.tasks.find((t) => t.id === "t-rt").status, "done");
  assert.ok(body.state.tasks.some((t) => t.title === "synced task" && t.due === "2026-07-14"));
  // missing/empty markdown and a paste with nothing syncable both 400
  const empty = await send("POST", "/api/sync/apply", { markdown: "   " });
  assert.equal(empty.status, 400);
  const prose = await send("POST", "/api/sync/preview", { markdown: "just prose, no items" });
  assert.equal(prose.status, 400);
  // the 400 carries the parse warnings — the only clue to why nothing was found
  const proseBody = await prose.json();
  assert.ok(Array.isArray(proseBody.warnings));
  assert.ok(proseBody.warnings.some((w) => /skipped line/.test(w)));
});

test("trash: a delete-by-absence is listed, restorable, and purgeable over HTTP", async () => {
  // a known tree to delete (this PUT trashes the earlier tests' leftovers — flushed below)
  let cur = await (await api("/api/state")).json();
  const setup = await send("PUT", "/api/state", {
    rev: cur.rev,
    roadmaps: [{ id: "TR", title: "Trash Track" }],
    milestones: [{ id: "TM", roadmapId: "TR", title: "Only" }],
    steps: [{ id: "TS", milestoneId: "TM", title: "Step one" }],
    tasks: [{ id: "tt", title: "trash me" }],
  });
  assert.equal(setup.status, 200);
  await api("/api/trash", { method: "DELETE" });

  // everything vanishes from the next PUT → one roadmap row (whole subtree) + one task row
  cur = await (await api("/api/state")).json();
  const wipe = await send("PUT", "/api/state", { rev: cur.rev, tasks: [] });
  assert.equal(wipe.status, 200);
  // the PUT's own response says what it trashed — the client's undo toast
  // binds to these ids rather than guessing at the newest trash row
  const receipt = (await wipe.json()).trashed;
  assert.deepEqual(receipt.map((r) => r.kind).sort(), ["roadmap", "task"]);
  const items = (await (await api("/api/trash")).json()).items;
  assert.equal(items.length, 2);
  assert.deepEqual(new Set(items.map((i) => i.id)), new Set(receipt.map((r) => r.id)));
  const rm = items.find((i) => i.kind === "roadmap");
  assert.equal(rm.title, "Trash Track");
  assert.equal(rm.counts, "1 milestone · 1 step"); // derived from the payload
  const task = items.find((i) => i.kind === "task");
  assert.equal(task.counts, null);

  // restore the roadmap: fresh state + what came back; the row leaves the trash
  const restore = await send("POST", "/api/trash/restore", { id: rm.id });
  assert.equal(restore.status, 200);
  const body = await restore.json();
  assert.deepEqual(body.restored, {
    id: rm.id,
    kind: "roadmap",
    title: "Trash Track",
    remapped: false,
  });
  assert.ok(body.state.roadmaps.some((r) => r.id === "TR"));
  assert.ok(body.state.steps.some((s) => s.id === "TS"));
  assert.equal((await (await api("/api/trash")).json()).items.length, 1);

  // restore is one-shot; bad bodies 400; unknown ids 404
  assert.equal((await send("POST", "/api/trash/restore", { id: rm.id })).status, 404);
  assert.equal((await send("POST", "/api/trash/restore", {})).status, 400);

  // purge one (idempotence → 404 the second time), then purge all
  assert.equal((await api(`/api/trash/${task.id}`, { method: "DELETE" })).status, 200);
  assert.equal((await api(`/api/trash/${task.id}`, { method: "DELETE" })).status, 404);
  const flushed = await (await api("/api/trash", { method: "DELETE" })).json();
  assert.equal(flushed.ok, true);
  assert.deepEqual((await (await api("/api/trash")).json()).items, []);
});

test("trash: a lone step delete is caught, and an orphaned step restore is a clear 409", async () => {
  // a fresh tree; flush whatever earlier tests left in the trash first
  const setup = await send("PUT", "/api/state", {
    roadmaps: [{ id: "SR", title: "Step Track" }],
    milestones: [{ id: "SM", roadmapId: "SR", title: "Only" }],
    steps: [{ id: "SS", milestoneId: "SM", title: "Lone step" }],
    tasks: [{ id: "st-t", title: "linked", stepId: "SS" }],
  });
  assert.equal(setup.status, 200);
  await api("/api/trash", { method: "DELETE" });

  // the client's per-step delete: step gone, task unlinked, roadmap survives
  const del = await send("PUT", "/api/state", {
    roadmaps: [{ id: "SR", title: "Step Track" }],
    milestones: [{ id: "SM", roadmapId: "SR", title: "Only" }],
    steps: [],
    tasks: [{ id: "st-t", title: "linked", stepId: null }],
  });
  assert.equal(del.status, 200);
  assert.deepEqual(
    (await del.json()).trashed.map((r) => [r.kind, r.title]),
    [["step", "Lone step"]],
  );
  const [row] = (await (await api("/api/trash")).json()).items;
  assert.equal(row.kind, "step");
  assert.equal(row.counts, null); // steps have nothing to count

  // restore while the milestone is alive: the step AND its task link come back
  const restore = await send("POST", "/api/trash/restore", { id: row.id });
  assert.equal(restore.status, 200);
  const body = await restore.json();
  assert.ok(body.state.steps.some((s) => s.id === "SS"));
  assert.equal(body.state.tasks.find((t) => t.id === "st-t").stepId, "SS");

  // delete the step again, then the whole roadmap — the step row's milestone is gone
  await send("PUT", "/api/state", {
    roadmaps: [{ id: "SR", title: "Step Track" }],
    milestones: [{ id: "SM", roadmapId: "SR", title: "Only" }],
    steps: [],
    tasks: [{ id: "st-t", title: "linked", stepId: null }],
  });
  await send("PUT", "/api/state", { tasks: [{ id: "st-t", title: "linked" }] });
  const stepRow = (await (await api("/api/trash")).json()).items.find((i) => i.kind === "step");
  const refused = await send("POST", "/api/trash/restore", { id: stepRow.id });
  assert.equal(refused.status, 409); // not a 404 — the entry exists, it just can't land
  assert.match((await refused.json()).error, /milestone is gone.*restore the whole roadmap/);
  await api("/api/trash", { method: "DELETE" }); // leave a clean trash for later tests
});

test("trash never rides along with state or export; import never trashes", async () => {
  const state = await (await api("/api/state")).json();
  assert.ok(!("trash" in state));
  const exported = await (await api("/api/export")).json();
  assert.ok(!("trash" in exported));
  // import replaces the whole model — deliberately without trashing the old one
  const imp = await send("POST", "/api/import", { tasks: [{ id: "imp-t", title: "imported" }] });
  assert.equal(imp.status, 200);
  assert.deepEqual((await (await api("/api/trash")).json()).items, []);
});

test("project ↔ roadmap link round-trips; a dangling ref is rejected like task links", async () => {
  let cur = await (await api("/api/state")).json();
  const ok = await send("PUT", "/api/state", {
    rev: cur.rev,
    roadmaps: [{ id: "LR", title: "Linked" }],
    projects: [{ id: "LP", title: "Build it", roadmapId: "LR" }],
  });
  assert.equal(ok.status, 200);
  const saved = await ok.json();
  assert.equal(saved.projects.find((p) => p.id === "LP").roadmapId, "LR");
  // a ref into nowhere gets the same 400 a dangling task.stepId gets
  const bad = await send("PUT", "/api/state", {
    projects: [{ id: "LP2", title: "Nope", roadmapId: "ghost" }],
  });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /missing roadmap "ghost"/);
});

test("sync carries notes blockquotes end-to-end", async () => {
  const res = await send("POST", "/api/sync/apply", {
    markdown: "## Tasks\n- [ ] noted task\n> remember the charger\n> and the cable\n",
  });
  assert.equal(res.status, 200);
  const { state } = await res.json();
  const t = state.tasks.find((x) => x.title === "noted task");
  assert.equal(t.notes, "remember the charger\nand the cable");
  // …and the export renders them back as blockquote lines
  const text = await (await api("/api/export.md")).text();
  assert.match(text, /- \[ \] noted task \{#.+\}\n {2}> remember the charger\n {2}> and the cable/);
});

test("GET /api/momentum ships the freeze budget breakdown", async () => {
  const m = await (await api("/api/momentum")).json();
  const f = m.freezes;
  for (const k of ["base", "earned", "total", "used", "left"]) {
    assert.equal(typeof f[k], "number", k);
  }
  assert.equal(f.total, f.base + f.earned);
  assert.equal(f.left, f.total - f.used);
  assert.equal(m.streak.freezes, f.total); // the field the client renders today
});

test("unknown API paths get a clean JSON 404, not the SPA shell", async () => {
  const res = await api("/api/nope");
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: "not found" });
});

// ── kata over HTTP ──────────────────────────────────────────────────────────────

test("kata: honor happy path + guards, and the today/dashboard/momentum blocks", async () => {
  // a clean slate: earlier tests completed real work TODAY, which would muddy
  // the goal/streak/heatmap assertions below
  assert.equal((await send("POST", "/api/reset", {})).status, 200);
  const put = await send("PUT", "/api/state", {
    kata: [
      { id: "K1", title: "greyscale phone", builtinId: "greyscale-phone" },
      { id: "K2", title: "shutdown ritual", builtinId: "shutdown" },
      { id: "K3", title: "retired form", active: false },
    ],
  });
  assert.equal(put.status, 200);
  assert.equal((await put.json()).kata.length, 3);

  // guards: missing id 400, unknown id 404, retired kata 400
  assert.equal((await send("POST", "/api/kata/honor", {})).status, 400);
  assert.equal((await send("POST", "/api/kata/honor", { id: "ghost" })).status, 404);
  const retired = await send("POST", "/api/kata/honor", { id: "K3" });
  assert.equal(retired.status, 400);
  assert.match((await retired.json()).error, /active/);

  // honor one — the response is the slim state plus the fresh kata block
  const res = await send("POST", "/api/kata/honor", { id: "K1" });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(!("completions" in body)); // lean write, like /api/complete
  assert.ok(!("kataDays" in body));
  assert.deepEqual(body.kataToday.today, { honored: 1, total: 2, clean: false });
  assert.deepEqual(
    body.kataToday.items.find((i) => i.id === "K1"),
    {
      id: "K1",
      title: "greyscale phone",
      builtinId: "greyscale-phone",
      active: true,
      honoredToday: true,
    },
  );

  // /api/today and /api/dashboard both carry the same kata block
  const today = await (await api("/api/today")).json();
  assert.deepEqual(today.kata.today, { honored: 1, total: 2, clean: false });
  assert.equal(today.kata.items.length, 2); // active kata only
  const dash = await (await api("/api/dashboard")).json();
  assert.deepEqual(dash.kata, today.kata);
  assert.ok(Array.isArray(dash.kataSuggestions)); // library suggestions, not nudges
  const d = dash.momentum.discipline;
  assert.equal(d.cleanDays, 0);
  assert.equal(d.grade.label, "無級");
  assert.equal(d.week.length, 7);
  assert.equal(d.week.at(-1).state, "pending"); // today, one of two honored

  // the second honor completes a clean day
  const clean = await send("POST", "/api/kata/honor", { id: "K2" });
  assert.deepEqual((await clean.json()).kataToday.today, { honored: 2, total: 2, clean: true });
  const m = await (await api("/api/momentum")).json();
  assert.equal(m.discipline.cleanDays, 1);
  assert.equal(m.discipline.cleanStreak, 1);
  assert.equal(m.discipline.grade.label, "10級");
  assert.equal(m.discipline.week.at(-1).state, "clean");
  // the invariant: kata never meet the goal or carry the streak…
  assert.equal(m.todayCount, 0);
  assert.equal(m.metGoal, false);
  assert.equal(m.streak.current, 0);
  // …but the heatmap and XP see the practice (2 honors × 5 m + 15 m clean bonus)
  assert.equal(m.heat.at(-1).count, 2);
  assert.equal(m.xp.todayM, 25);
  assert.equal(m.xp.totalM, 25);

  // un-honoring retracts the credit and the clean day
  const undo = await send("POST", "/api/kata/honor", { id: "K2", on: false });
  assert.deepEqual((await undo.json()).kataToday.today, { honored: 1, total: 2, clean: false });
  assert.equal((await (await api("/api/momentum")).json()).xp.todayM, 5);
});

test("kata: the ≤5-active rule holds over PUT and sync apply alike", async () => {
  const five = Array.from({ length: 5 }, (_, i) => ({ id: `F${i}`, title: `form ${i}` }));
  const bad = await send("PUT", "/api/state", {
    kata: [...five, { id: "F6", title: "one too many" }],
  });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /at most 5 kata/);
  assert.equal((await send("PUT", "/api/state", { kata: five })).status, 200);
  // sync: activating a sixth is a clean 400, a retired sixth lands fine
  const res = await send("POST", "/api/sync/apply", { markdown: "## Kata\n- [x] a sixth form\n" });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /at most 5 kata/);
  const ok = await send("POST", "/api/sync/apply", { markdown: "## Kata\n- [ ] a sixth form\n" });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).applied.createdCounts.kata, 1);
});

test("kata: a delete-by-absence is trashed and restorable over HTTP", async () => {
  await send("PUT", "/api/state", { kata: [{ id: "KT", title: "doomed form", note: "keep me" }] });
  await api("/api/trash", { method: "DELETE" }); // flush earlier leftovers
  const wipe = await send("PUT", "/api/state", { kata: [] });
  assert.equal(wipe.status, 200);
  assert.deepEqual(
    (await wipe.json()).trashed.map((r) => [r.kind, r.title]),
    [["kata", "doomed form"]],
  );
  const [row] = (await (await api("/api/trash")).json()).items;
  assert.equal(row.kind, "kata");
  assert.equal(row.counts, null); // nothing to count on a lone kata
  const restore = await send("POST", "/api/trash/restore", { id: row.id });
  assert.equal(restore.status, 200);
  const body = await restore.json();
  assert.equal(body.restored.kind, "kata");
  const back = body.state.kata.find((k) => k.id === "KT");
  assert.equal(back.note, "keep me");
  // export/import round-trips the dōjō AND the honor ledger over the wire
  await send("POST", "/api/kata/honor", { id: "KT" });
  const exported = await (await api("/api/export")).json();
  assert.equal(exported.kataDays.length, 1);
  await send("POST", "/api/reset", {});
  const imp = await send("POST", "/api/import", exported);
  assert.equal(imp.status, 200);
  assert.deepEqual((await imp.json()).kataDays, exported.kataDays);
});

test("kata honor: no future days, `on` must be boolean-ish, backdating still lands", async () => {
  await send("POST", "/api/reset", {});
  await send("PUT", "/api/state", { kata: [{ id: "KB", title: "backdated form" }] });
  const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10); // TZ=UTC

  // tomorrow is a fiction the day's ledger would then defend — a clean 400
  const future = await send("POST", "/api/kata/honor", { id: "KB", day: day(1) });
  assert.equal(future.status, 400);
  assert.match((await future.json()).error, /future/);

  // `on` mirrors validateState's boolean handling: a truthy string like "false"
  // silently honoring would be a surprise — reject anything but a clear bool/0/1
  const stringy = await send("POST", "/api/kata/honor", { id: "KB", on: "false" });
  assert.equal(stringy.status, 400);
  assert.match((await stringy.json()).error, /boolean/);

  // …while an honest backdate to yesterday still lands, ledger and all
  const past = await send("POST", "/api/kata/honor", { id: "KB", day: day(-1) });
  assert.equal(past.status, 200);
  assert.deepEqual((await past.json()).kataToday.today, { honored: 1, total: 1, clean: true });
  const exported = await (await api("/api/export")).json();
  assert.deepEqual(exported.kataDays, [{ day: day(-1), activeIds: ["KB"], honoredIds: ["KB"] }]);
});
