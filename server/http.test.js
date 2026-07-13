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
  const items = (await (await api("/api/trash")).json()).items;
  assert.equal(items.length, 2);
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
