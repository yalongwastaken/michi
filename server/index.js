// index.js — the mini-PC brain. Express API + serves the built client.
// Bind to 0.0.0.0 so it's reachable over the LAN / Tailscale (never exposed publicly).
import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import {
  getState,
  getFullState,
  putState,
  validateState,
  validateTask,
  addTask,
  setDone,
  resetAll,
  importAll,
  getPlanSkips,
  setPlanSkip,
  listTrash,
  restoreTrash,
  purgeTrash,
  purgeAllTrash,
  getKata,
  getKataToday,
  setKataHonored,
  getJournalRange,
  addJournalEntry,
  updateJournalEntry,
  deleteJournalEntry,
  ConflictError,
} from "./db.js";
import { buildToday, momentum } from "./engine.js";
import { dayKey } from "./dates.js";
import { planDay } from "./planner.js";
import { insights, kataSuggestions } from "./insights.js";
import { weeklyReview } from "./review.js";
import { buildDigest } from "./digest.js";
import { aiConfig, aiEnabled, refinePlan } from "./suggest.js";
import { draftStructured, normalizeMode } from "./draft.js";
import { listBackups, runBackup, backupDir } from "./backup.js";
import { renderExport, parseSync, planSync, applySync, hasParsedItems } from "./markdown.js";

// a valid calendar day string, else server-local today — so a malformed ?day= can't
// reach the date math in momentum()/planner and 500 the request
function resolveDay(q) {
  return typeof q === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(q) &&
    !Number.isNaN(Date.parse(`${q}T12:00:00Z`))
    ? q
    : dayKey();
}

// shared planner options from settings (+ today's "not today" skips). `day` concrete.
function planOpts(state, day, overrides = {}) {
  const s = state.settings || {};
  return {
    today: day,
    budgetMin: s.dailyMinutes,
    defaultStepMin: s.defaultStepMin,
    taskDefaultMin: s.taskDefaultMin,
    skip: getPlanSkips(day),
    ...overrides,
  };
}

const __dirname = dirname(fileURLToPath(import.meta.url));
// exported so http.test.js can boot the real app on an ephemeral port; the module
// only grabs the real port when run as the main entry (see the bottom of the file)
export const app = express();
app.disable("x-powered-by"); // don't advertise the framework
app.use(express.json({ limit: "5mb" }));

// CSRF / DNS-rebinding guard: a browser sends Origin on cross-site writes. If a
// mutating request carries an Origin whose host isn't ours, reject it — this stops
// a malicious page on the tailnet from POSTing /api/reset etc. Same-origin app
// fetches (Origin === Host) and non-browser tools (no Origin) pass through.
app.use((req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    return next();
  }
  const origin = req.get("origin");
  if (origin) {
    let host;
    try {
      host = new URL(origin).host;
    } catch {
      return res.status(403).json({ error: "bad origin" });
    }
    if (host !== req.get("host")) {
      return res.status(403).json({ error: "cross-origin request blocked" });
    }
  }
  next();
});

// ── API ─────────────────────────────────────────────────────────────────────
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// client capability probe — lets the UI show the "Smarter plan" action only when a
// local model is configured. Reports model name but never any secrets.
app.get("/api/config", (_req, res) => {
  const cfg = aiConfig();
  res.json({ ai: cfg.enabled, model: cfg.enabled ? cfg.model : null });
});

// full model (client loads this once on boot). Deliberately *without* the
// completions log — it grows forever and the client never reads it (streaks and
// the heatmap arrive precomputed via /api/momentum); /api/export carries it.
app.get("/api/state", (_req, res) => res.json(getState()));

// pragmatic full-state replace (client's "save" — see db.js). The response is
// the fresh state plus `trashed: [{id, kind, title}]`, the receipt of whatever
// this PUT snapshotted into trash (empty when nothing vanished) — what the
// client's undo toast binds to.
app.put("/api/state", (req, res) => {
  const body = req.body || {};
  const bad = validateState(body);
  if (bad) {
    return res.status(400).json({ error: bad });
  }
  try {
    res.json(putState(body, body.rev));
  } catch (e) {
    if (e instanceof ConflictError) {
      return res.status(409).json({ error: e.message, state: getState() });
    }
    console.warn("PUT /api/state failed:", e.message);
    res.status(400).json({ error: "could not save — check your data" });
  }
});

// append a single task (the common case — no full-state PUT, no rev clash)
app.post("/api/tasks", (req, res) => {
  const t = req.body || {};
  const bad = validateTask(t);
  if (bad) {
    return res.status(400).json({ error: bad });
  }
  try {
    res.json(addTask(t));
  } catch (e) {
    console.warn("POST /api/tasks failed:", e.message);
    res.status(400).json({ error: "could not add that task" });
  }
});

// toggle completion of a task or a step (the core daily interaction)
app.post("/api/complete", (req, res) => {
  const { kind, id, done = true } = req.body || {};
  if (kind !== "task" && kind !== "step") {
    return res.status(400).json({ error: "kind must be 'task' or 'step'" });
  }
  if (!id) {
    return res.status(400).json({ error: "id is required" });
  }
  try {
    res.json(setDone(kind, id, !!done));
  } catch (e) {
    console.warn("POST /api/complete failed:", e.message);
    res.status(404).json({ error: "could not find that item" });
  }
});

// honor (or unhonor) a kata for the day — the kata sibling of /api/complete.
// Honoring writes a completions row (kind "kata") and snapshots/updates the day's
// kata_days ledger; the response is the slim state plus the fresh kata block.
app.post("/api/kata/honor", (req, res) => {
  const { id, on = true } = req.body || {};
  if (!id) {
    return res.status(400).json({ error: "id is required" });
  }
  // bool-ish only, mirroring validateState's kata.active rule: a truthy string
  // like "false" silently honoring a form would be a surprise — reject it
  if (typeof on !== "boolean" && on !== 0 && on !== 1) {
    return res.status(400).json({ error: "on must be a boolean" });
  }
  const k = getKata(id);
  if (!k) {
    return res.status(404).json({ error: "could not find that kata" });
  }
  if (!k.active) {
    return res
      .status(400)
      .json({ error: "that kata is retired — only active kata can be honored" });
  }
  // a valid ?day override is test/tooling sugar; everyday honors land on today.
  // Backdating an honest "I held the form yesterday" is fine — the future isn't:
  // a forward snapshot would be a fiction the day's ledger then defends.
  const day =
    typeof req.body?.day === "string" && req.body.day === resolveDay(req.body.day)
      ? req.body.day
      : undefined;
  if (day && day > dayKey()) {
    return res.status(400).json({ error: "can't honor a kata in the future" });
  }
  try {
    const state = day ? setKataHonored(id, !!on, undefined, day) : setKataHonored(id, !!on);
    res.json({ ...state, kataToday: getKataToday(day) });
  } catch (e) {
    console.warn("POST /api/kata/honor failed:", e.message);
    res.status(400).json({ error: "could not update that kata" });
  }
});

// a positive, sane minutes budget, else undefined (planner falls back to settings)
function resolveBudget(q) {
  const b = Number(q);
  return Number.isFinite(b) && b > 0 && b <= 1440 ? { budgetMin: b } : {};
}

// the daily queue — "what should I work on today?" (+ the day's kata block)
app.get("/api/today", (req, res) => {
  // a negative finite limit would reach slice(0, -1) and silently drop items —
  // out-of-range falls back to the default, same policy as resolveBudget
  const limit = Number(req.query.limit);
  const day = resolveDay(req.query.day);
  res.json({
    ...buildToday(getState(), {
      today: day,
      limit: Number.isFinite(limit) && limit >= 0 ? limit : undefined,
    }),
    kata: getKataToday(day),
  });
});

// momentum: streak, heatmap, roadmap/project progress
// (getFullState: streak/heatmap math consumes the completion history)
app.get("/api/momentum", (req, res) => {
  res.json(momentum(getFullState(), { today: resolveDay(req.query.day) }));
});

// the planner — a doable day from the whole picture. Deterministic by default;
// with ?ai=1 (and MICHI_LLM enabled) a local model refines it, falling back to the
// deterministic plan on any hiccup. ?budget= overrides the day's time budget.
app.get("/api/plan", async (req, res, next) => {
  try {
    const state = getFullState(); // planner reads history (neglect rotation)
    const day = resolveDay(req.query.day);
    const o = planOpts(state, day, resolveBudget(req.query.budget));
    const plan = planDay(state, o);
    const wantAi = req.query.ai === "1" || req.query.ai === "true";
    res.json(wantAi ? await refinePlan(state, plan, { ...o, budgetMin: plan.budgetMin }) : plan);
  } catch (e) {
    next(e);
  }
});

// one round-trip for the whole Today screen: queue + momentum + plan + nudges.
// ?budget= sizes the plan like /api/plan does (the client's "one more" boost —
// without it, the next refresh would rebuild the plan from settings and shrink it)
app.get("/api/dashboard", (req, res, next) => {
  try {
    const state = getFullState(); // momentum/plan/insights/review read history
    const day = resolveDay(req.query.day);
    res.json({
      today: buildToday(state, { today: day }),
      momentum: momentum(state, { today: day }),
      plan: planDay(state, planOpts(state, day, resolveBudget(req.query.budget))),
      insights: insights(state, { today: day }),
      review: weeklyReview(state, { today: day }),
      kata: getKataToday(day),
      // library suggestions, rendered in the dōjō — deliberately not nudges
      kataSuggestions: kataSuggestions(state, { today: day }),
    });
  } catch (e) {
    next(e);
  }
});

// a plain-text (or JSON) summary for a cron → local notifier (no cloud).
// ?mode=morning (default) looks at the day ahead; ?mode=evening looks back.
app.get("/api/digest", (req, res, next) => {
  try {
    const mode = req.query.mode ?? "morning";
    if (mode !== "morning" && mode !== "evening") {
      return res.status(400).json({ error: "mode must be 'morning' or 'evening'" });
    }
    const state = getFullState(); // streak + plan both read history
    const day = resolveDay(req.query.day);
    const d = buildDigest(state, { ...planOpts(state, day), mode });
    if (req.query.format === "text" || (req.get("accept") || "").includes("text/plain")) {
      res.type("text/plain").send(d.text);
    } else {
      res.json(d);
    }
  } catch (e) {
    next(e);
  }
});

// "not today" — push a plan item off the day (or restore it with {on:false})
app.post("/api/plan/skip", (req, res) => {
  const { kind, id, on = true } = req.body || {};
  if ((kind !== "task" && kind !== "step") || !id) {
    return res.status(400).json({ error: "need kind ('task'|'step') and id" });
  }
  try {
    const day = resolveDay(req.body?.day);
    setPlanSkip(day, kind, id, !!on);
    const state = getFullState(); // planner reads history (neglect rotation)
    res.json(planDay(state, planOpts(state, day)));
  } catch (e) {
    console.warn("POST /api/plan/skip failed:", e.message);
    res.status(400).json({ error: "could not update the plan" });
  }
});

// wipe everything and start fresh (the Settings "danger zone")
app.post("/api/reset", (_req, res) => {
  try {
    res.json(resetAll());
  } catch (e) {
    console.warn("POST /api/reset failed:", e.message);
    res.status(500).json({ error: "reset failed" });
  }
});

// ── trash: the undo net for deletes-by-absence ────────────────────────────────
// The full-state PUT snapshots whatever disappears from it (see db.js); these
// endpoints list, restore, and purge those snapshots. Trash never rides along
// with state/export — it's a safety net, not model data.
app.get("/api/trash", (_req, res) => res.json({ items: listTrash() }));

// restore one snapshot → { state, restored: {id, kind, title, remapped} }.
// Colliding ids (the user recreated the item) are remapped inside restoreTrash.
app.post("/api/trash/restore", (req, res) => {
  const { id } = req.body || {};
  if (!id) {
    return res.status(400).json({ error: "id is required" });
  }
  try {
    res.json(restoreTrash(id));
  } catch (e) {
    if (e instanceof ConflictError) {
      // a step row whose milestone is gone — the entry exists but can't land
      // here; the message points at the roadmap row as the working restore path
      return res.status(409).json({ error: e.message });
    }
    console.warn("POST /api/trash/restore failed:", e.message);
    res.status(404).json({ error: "could not find that trash entry" });
  }
});

// purge one entry / empty the whole trash (both permanent)
app.delete("/api/trash/:id", (req, res) => {
  if (!purgeTrash(req.params.id)) {
    return res.status(404).json({ error: "could not find that trash entry" });
  }
  res.json({ ok: true });
});
app.delete("/api/trash", (_req, res) => res.json({ ok: true, purged: purgeAllTrash() }));

// ── backups: the nightly snapshot folder, visible from the app ───────────────
// Reads the same folder the systemd timer / `make backup` writes to, so Settings
// can show whether the safety net is actually catching anything.
app.get("/api/backups", (_req, res) => {
  try {
    res.json({ dir: backupDir(), items: listBackups() });
  } catch (e) {
    console.warn("GET /api/backups failed:", e.message);
    res.status(500).json({ error: "could not read the backups folder" });
  }
});

// take a snapshot right now (same VACUUM INTO + keep-14 rotation as the timer)
app.post("/api/backup", (_req, res) => {
  try {
    res.json(runBackup());
  } catch (e) {
    console.warn("POST /api/backup failed:", e.message);
    res.status(500).json({ error: "backup failed — is the backups folder writable?" });
  }
});

// data export (download the whole dataset) + import (validated full replace).
// Export is the one read that ships the completions log — a backup must carry
// your streak history so a restore brings it back (importAll rebuilds the log).
app.get("/api/export", (_req, res) => {
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="michi-${new Date().toISOString().slice(0, 10)}.json"`,
  );
  res.json(getFullState());
});
app.post("/api/import", (req, res) => {
  const body = req.body || {};
  const bad = validateState(body);
  if (bad) {
    return res.status(400).json({ error: bad });
  }
  try {
    // no rev check — deliberate replace. One transaction for tables + completions
    // (import is the one path that rebuilds server-owned activity history), so a
    // failure late in the import can't half-apply it while reporting an error.
    res.json(importAll(body));
  } catch (e) {
    console.warn("POST /api/import failed:", e.message);
    res.status(400).json({ error: "import failed — file may be malformed" });
  }
});

// Markdown export/sync — the human/Claude-friendly sibling of the JSON export.
// GET /api/export.md renders the model (instruction header + snapshot) as Markdown;
// Claude's reply goes to /api/sync/preview (dry-run) or /api/sync/apply. Sync is
// create + update only — it never deletes, archives, or writes completion history.
app.get("/api/export.md", (_req, res) => {
  const today = dayKey(); // server-local, the same "today" the rest of the API uses
  res.setHeader("Content-Disposition", `attachment; filename="michi-claude-${today}.md"`);
  res.type("text/markdown").send(renderExport(getFullState(), today));
});

// shared guard for the sync endpoints: a parsed doc, or null after a 400 was sent
function parseSyncBody(req, res) {
  const md = req.body?.markdown;
  if (typeof md !== "string" || !md.trim()) {
    res.status(400).json({ error: "markdown is required" });
    return null;
  }
  const parsed = parseSync(md);
  if (!hasParsedItems(parsed)) {
    // the parse warnings are the only clue to WHY nothing was found — ship them
    res.status(400).json({
      error: "no michi items found in that markdown",
      warnings: parsed.warnings,
    });
    return null;
  }
  return parsed;
}

app.post("/api/sync/preview", (req, res) => {
  const parsed = parseSyncBody(req, res);
  if (!parsed) {
    return;
  }
  try {
    const plan = planSync(parsed, getFullState());
    res.json({
      creates: Object.fromEntries(
        Object.entries(plan.creates).map(([kind, items]) => [
          kind,
          { count: items.length, items: items.map((i) => ({ id: i.id, title: i.title })) },
        ]),
      ),
      updates: plan.updates,
      warnings: [...parsed.warnings, ...plan.warnings],
    });
  } catch (e) {
    console.warn("POST /api/sync/preview failed:", e.message);
    res.status(400).json({ error: "could not plan that sync" });
  }
});

app.post("/api/sync/apply", (req, res) => {
  const parsed = parseSyncBody(req, res);
  if (!parsed) {
    return;
  }
  try {
    const { state, applied, warnings } = applySync(parsed);
    res.json({ state, applied, warnings: [...parsed.warnings, ...warnings] });
  } catch (e) {
    console.warn("POST /api/sync/apply failed:", e.message);
    res.status(400).json({ error: e.message || "sync failed" });
  }
});

// POST /api/ai/draft — turn pasted raw content into sync markdown with the local
// model. Returns markdown only; the client runs it through /api/sync/preview +
// /api/sync/apply, so the same validation + human approval as a pasted reply apply.
app.post("/api/ai/draft", async (req, res) => {
  if (!aiEnabled()) {
    return res.status(503).json({ error: "the local model is off — set MICHI_LLM=1 to enable it" });
  }
  const text = req.body?.text;
  if (typeof text !== "string" || !text.trim()) {
    return res.status(400).json({ error: "paste some text to draft from" });
  }
  if (text.length > 20000) {
    return res.status(413).json({ error: "that's a lot of text — trim it under ~20k characters" });
  }
  try {
    const markdown = await draftStructured(text, normalizeMode(req.body?.mode), {
      today: dayKey(),
    });
    if (!markdown) {
      return res.status(502).json({ error: "the model didn't return a usable draft — try again" });
    }
    res.json({ markdown });
  } catch (e) {
    console.warn("POST /api/ai/draft failed:", e.message);
    res.status(502).json({ error: "could not reach the local model" });
  }
});

// ── journal / time log ──────────────────────────────────────────────────────
// Validate a create/update body. `partial` (PATCH) lets fields be absent.
function validateJournalInput(b, { partial = false } = {}) {
  if (!b || typeof b !== "object") {
    return "body must be an object";
  }
  if (!partial || b.title !== undefined) {
    if (typeof b.title !== "string" || !b.title.trim()) {
      return "title is required";
    }
  }
  for (const f of ["startMin", "endMin"]) {
    const v = b[f];
    if (v != null && (!Number.isFinite(Number(v)) || Number(v) < 0 || Number(v) > 1440)) {
      return `${f} must be minutes between 0 and 1440`;
    }
  }
  if (b.startMin != null && b.endMin != null && Number(b.endMin) < Number(b.startMin)) {
    return "end must be at or after start";
  }
  return null;
}

// GET /api/journal?from=YYYY-MM-DD&to=YYYY-MM-DD — entries in range (default: the
// month around today, so the calendar has something to render on first open)
app.get("/api/journal", (req, res) => {
  const today = dayKey();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || "")
    ? req.query.from
    : `${today.slice(0, 7)}-01`;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || "")
    ? req.query.to
    : `${today.slice(0, 7)}-31`;
  res.json({ entries: getJournalRange(from, to) });
});

app.post("/api/journal", (req, res) => {
  const b = req.body || {};
  const bad = validateJournalInput(b);
  if (bad) {
    return res.status(400).json({ error: bad });
  }
  const day = resolveDay(b.day); // a bad/absent day falls back to server-local today
  try {
    res.json({ entry: addJournalEntry({ ...b, day }) });
  } catch (e) {
    console.warn("POST /api/journal failed:", e.message);
    res.status(400).json({ error: "could not save that log entry" });
  }
});

app.patch("/api/journal/:id", (req, res) => {
  const b = req.body || {};
  const bad = validateJournalInput(b, { partial: true });
  if (bad) {
    return res.status(400).json({ error: bad });
  }
  if (b.day !== undefined && b.day !== resolveDay(b.day)) {
    return res.status(400).json({ error: "day must be a valid date" });
  }
  try {
    const entry = updateJournalEntry(req.params.id, b);
    if (!entry) {
      return res.status(404).json({ error: "no such entry" });
    }
    res.json({ entry });
  } catch (e) {
    console.warn("PATCH /api/journal failed:", e.message);
    res.status(400).json({ error: "could not update that entry" });
  }
});

app.delete("/api/journal/:id", (req, res) => {
  res.json({ ok: deleteJournalEntry(req.params.id) });
});

// unknown API paths get a clean 404 (not the SPA shell)
app.use("/api", (_req, res) => res.status(404).json({ error: "not found" }));

// ── serve the built client (client/dist) when present ────────────────────────
// registered unconditionally and checked per-request (express.static stats files
// lazily; the fallback checks existsSync) so building the client after the server
// started begins serving the app without a restart
const dist = join(__dirname, "..", "client", "dist");
app.use(express.static(dist));
app.get("*", (_req, res) => {
  const index = join(dist, "index.html");
  if (existsSync(index)) {
    return res.sendFile(index);
  }
  res
    .status(404)
    .type("text/plain")
    .send("Michi API is running, but the client isn't built yet — run `make build`.");
});

// terminal error handler — turns thrown/rejected route errors into a clean 500
app.use((err, _req, res, _next) => {
  console.warn("unhandled route error:", err?.message || err);
  if (!res.headersSent) {
    const status = err?.status || err?.statusCode || 500;
    res.status(status >= 400 && status < 600 ? status : 500).json({
      error: status >= 400 && status < 500 ? "bad request" : "server error",
    });
  }
});

// listen only when this file is the entry point (`node index.js` / systemd) —
// importing the app (integration tests) must not bind the production port. Node
// resolves argv[1] to an absolute path, so it matches this module's own path.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const PORT = process.env.PORT || 4001;
  const HOST = process.env.HOST || "0.0.0.0";
  const server = app.listen(PORT, HOST, () =>
    console.log(`michi server on http://${HOST}:${PORT}`),
  );
  // without this, a bind failure throws unhandled and systemd (RestartSec=3) loops it
  // tight forever — log something actionable and exit cleanly instead
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`michi: port ${PORT} already in use — is another instance running?`);
    } else {
      console.error(`michi: could not listen on ${HOST}:${PORT} — ${err.message}`);
    }
    process.exit(1);
  });
}
