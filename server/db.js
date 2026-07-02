// db.js — SQLite schema + accessors for Michi's unified data model.
// Single-user, single SQLite file. Uses Node's built-in node:sqlite — no native
// build step, nothing to compile on the mini PC. (Run node with --experimental-sqlite.)
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";
import { localDay } from "./dates.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.MICHI_DB || join(__dirname, "data", "michi.db");

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
  -- a learning path: a roadmap.sh-style track, a GitHub roadmap, a course, a book…
  CREATE TABLE IF NOT EXISTS roadmaps (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    source_url  TEXT,                -- where it came from (roadmap.sh, a GH repo, …)
    color       TEXT,
    archived    INTEGER NOT NULL DEFAULT 0,
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    target_date TEXT,                -- optional "finish by" date → enables pacing
    step_minutes INTEGER             -- optional avg minutes/step → better budgeting
  );

  -- a major checkpoint within a roadmap (e.g. "Fundamentals", "Drivers")
  CREATE TABLE IF NOT EXISTS milestones (
    id         TEXT PRIMARY KEY,
    roadmap_id TEXT NOT NULL REFERENCES roadmaps(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    position   INTEGER NOT NULL DEFAULT 0
  );

  -- a concrete learnable unit inside a milestone
  CREATE TABLE IF NOT EXISTS steps (
    id           TEXT PRIMARY KEY,
    milestone_id TEXT NOT NULL REFERENCES milestones(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'todo',  -- todo | doing | done
    position     INTEGER NOT NULL DEFAULT 0,
    resource_url TEXT,
    notes        TEXT,
    done_at      TEXT                            -- ISO timestamp when marked done
  );

  -- a meaningful thing to build/ship (the point of the learning)
  CREATE TABLE IF NOT EXISTS projects (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'idea',     -- idea | active | shipped
    repo_url   TEXT,
    summary    TEXT,
    position   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    shipped_at TEXT
  );

  -- the daily layer: standalone tasks, optionally tied to a step and/or a project
  CREATE TABLE IF NOT EXISTS tasks (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'todo',    -- todo | doing | done
    due         TEXT,                            -- optional ISO date (YYYY-MM-DD)
    recurrence  TEXT,                            -- null | daily | weekdays | weekly
    step_id     TEXT REFERENCES steps(id) ON DELETE SET NULL,
    project_id  TEXT REFERENCES projects(id) ON DELETE SET NULL,
    est_min     INTEGER,                         -- rough effort estimate (minutes)
    position    INTEGER NOT NULL DEFAULT 0,
    notes       TEXT,
    created_at  TEXT NOT NULL,
    done_at     TEXT                             -- ISO timestamp when last completed
  );
  CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
  CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due);
  CREATE INDEX IF NOT EXISTS idx_steps_status ON steps(status);

  -- append-only activity log: one row per completion *event*, bucketed by the
  -- local day it happened. This is the source of truth for streaks/heatmap, so a
  -- recurring habit completed every day accumulates real history (a single mutable
  -- done_at column can't — it just gets overwritten). Intentionally no FK to
  -- tasks/steps: deleting a roadmap shouldn't erase the days you showed up.
  CREATE TABLE IF NOT EXISTS completions (
    id     TEXT PRIMARY KEY,
    day    TEXT NOT NULL,                         -- local YYYY-MM-DD
    kind   TEXT NOT NULL,                         -- task | step
    ref_id TEXT NOT NULL,
    ts     TEXT NOT NULL,                         -- full ISO timestamp
    UNIQUE(kind, ref_id, day)                     -- at most one per item per day
  );
  CREATE INDEX IF NOT EXISTS idx_completions_day ON completions(day);

  -- flexible JSON blobs for the evolving profile + settings + rev
  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL                          -- JSON
  );
`);

// migrate older DBs that predate the roadmap pacing columns
{
  const cols = db
    .prepare("PRAGMA table_info(roadmaps)")
    .all()
    .map((c) => c.name);
  if (!cols.includes("target_date")) {
    db.exec("ALTER TABLE roadmaps ADD COLUMN target_date TEXT");
  }
  if (!cols.includes("step_minutes")) {
    db.exec("ALTER TABLE roadmaps ADD COLUMN step_minutes INTEGER");
  }
}

// ── defaults ──────────────────────────────────────────────────────────────────
const DEFAULT_PROFILE = {
  name: "",
  focusAreas: [], // freeform tags the user is investing in right now
  onboarded: false,
};
const DEFAULT_SETTINGS = {
  theme: "system", // system | light | dark
  dailyGoal: 3, // completions/day that count as "hit your goal"
  streakFreezes: 2, // missed days the streak can bridge before it breaks
  dailyMinutes: 60, // the planner's daily time budget
  defaultStepMin: 30, // assumed effort for a roadmap step with no estimate
  taskDefaultMin: 20, // assumed effort for a task with no estimate
};

/** Strict calendar-day check: YYYY-MM-DD that round-trips (rejects 2024-02-30 etc). */
function isValidDay(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return false;
  }
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const STEP_STATUS = new Set(["todo", "doing", "done"]);
const TASK_STATUS = new Set(["todo", "doing", "done"]);
const PROJECT_STATUS = new Set(["idea", "active", "shipped"]);
const RECURRENCE = new Set(["daily", "weekdays", "weekly"]);
const COMPLETION_KINDS = new Set(["task", "step"]);

// sane bounds for the numeric settings — a huge/Infinity streakFreezes would make
// computeStreak() walk back day-by-day (nearly) forever and wedge the event loop
const SETTING_RANGES = {
  dailyGoal: [0, 1000], // 0 is valid "rest mode"
  streakFreezes: [0, 365],
  dailyMinutes: [0, 1440],
  defaultStepMin: [0, 1440],
  taskDefaultMin: [0, 1440],
};

const newId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** Read a JSON blob from the meta table, or `fallback` if absent. */
function getMeta(key, fallback) {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
  return row ? JSON.parse(row.value) : fallback;
}

/** Upsert a JSON blob into the meta table. */
function setMeta(key, obj) {
  db.prepare(
    "INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, JSON.stringify(obj));
}

// ── optimistic-concurrency rev (guards two tabs clobbering each other) ──────────
function getRev() {
  return getMeta("rev", 0);
}
function bumpRev() {
  setMeta("rev", getRev() + 1);
}

// ── validation: reject obviously malformed writes ───────────────────────────────
/**
 * Validate a full-state PUT body.
 * @returns {string|null} an error message, or null when valid
 */
export function validateState(s) {
  if (!s || typeof s !== "object") {
    return "body must be an object";
  }
  // `completions` may be present (import validates + rebuilds the log) or absent —
  // the everyday PUT ignores the key entirely, so a client that never saw the log
  // (GET /api/state doesn't ship it) still validates cleanly
  for (const k of ["roadmaps", "milestones", "steps", "projects", "tasks", "completions"]) {
    if (s[k] != null && !Array.isArray(s[k])) {
      return `${k} must be an array`;
    }
  }
  for (const r of s.roadmaps || []) {
    if (!r?.id || !r?.title) {
      return "roadmap needs an id and title";
    }
    if (r.targetDate != null && r.targetDate !== "" && !isValidDay(r.targetDate)) {
      return "roadmap.targetDate is not a valid date";
    }
    if (
      r.stepMinutes != null &&
      (!Number.isFinite(Number(r.stepMinutes)) || Number(r.stepMinutes) < 0)
    ) {
      return "roadmap.stepMinutes must be a non-negative number";
    }
  }
  for (const m of s.milestones || []) {
    if (!m?.id || !m?.roadmapId) {
      return "milestone needs an id and roadmapId";
    }
    if (!m.title || !String(m.title).trim()) {
      return "milestone needs a title";
    }
  }
  for (const st of s.steps || []) {
    if (!st?.id || !st?.milestoneId) {
      return "step needs an id and milestoneId";
    }
    if (!st.title || !String(st.title).trim()) {
      return "step needs a title";
    }
    if (st.status != null && !STEP_STATUS.has(st.status)) {
      return `bad step status: ${st.status}`;
    }
  }
  for (const p of s.projects || []) {
    if (!p?.id || !p?.title) {
      return "project needs an id and title";
    }
    if (p.status != null && !PROJECT_STATUS.has(p.status)) {
      return `bad project status: ${p.status}`;
    }
  }
  for (const t of s.tasks || []) {
    const bad = validateTask(t);
    if (bad) {
      return bad;
    }
  }
  // duplicate ids / dangling references would only surface as generic SQL errors
  // deep inside the import — catch them here with messages that say what's wrong
  for (const [key, label] of [
    ["roadmaps", "roadmap"],
    ["milestones", "milestone"],
    ["steps", "step"],
    ["projects", "project"],
    ["tasks", "task"],
  ]) {
    const seen = new Set();
    for (const x of s[key] || []) {
      if (seen.has(x.id)) {
        return `duplicate ${label} id "${x.id}"`;
      }
      seen.add(x.id);
    }
  }
  const roadmapIds = new Set((s.roadmaps || []).map((r) => r.id));
  const milestoneIds = new Set((s.milestones || []).map((m) => m.id));
  const stepIds = new Set((s.steps || []).map((st) => st.id));
  const projectIds = new Set((s.projects || []).map((p) => p.id));
  for (const m of s.milestones || []) {
    if (!roadmapIds.has(m.roadmapId)) {
      return `milestone "${m.id}" references missing roadmap "${m.roadmapId}"`;
    }
  }
  for (const st of s.steps || []) {
    if (!milestoneIds.has(st.milestoneId)) {
      return `step "${st.id}" references missing milestone "${st.milestoneId}"`;
    }
  }
  for (const t of s.tasks || []) {
    if (t.stepId && !stepIds.has(t.stepId)) {
      return `task "${t.id}" references missing step "${t.stepId}"`;
    }
    if (t.projectId && !projectIds.has(t.projectId)) {
      return `task "${t.id}" references missing project "${t.projectId}"`;
    }
  }
  if (s.profile != null) {
    if (typeof s.profile !== "object" || Array.isArray(s.profile)) {
      return "profile must be an object";
    }
    if (s.profile.name != null && typeof s.profile.name !== "string") {
      return "profile.name must be a string";
    }
  }
  if (s.settings != null) {
    if (typeof s.settings !== "object" || Array.isArray(s.settings)) {
      return "settings must be an object";
    }
    for (const [k, [min, max]] of Object.entries(SETTING_RANGES)) {
      const v = s.settings[k];
      if (v == null) {
        continue; // absent → defaults apply (backward-compatible)
      }
      const n = Number(v);
      if (!Number.isFinite(n) || n < min || n > max) {
        return `settings.${k} must be a number between ${min} and ${max}`;
      }
    }
  }
  return null; // ok
}

/**
 * Validate a single task (used by both full-state and the lean append endpoint).
 * @returns {string|null} an error message, or null when valid
 */
export function validateTask(t) {
  if (!t || typeof t !== "object") {
    return "task must be an object";
  }
  if (!t.id) {
    return "task needs an id";
  }
  if (!t.title || !String(t.title).trim()) {
    return "task needs a title";
  }
  if (t.status != null && !TASK_STATUS.has(t.status)) {
    return `bad task status: ${t.status}`;
  }
  // a garbage/rollover due date would persist and silently skew the queue + streaks
  if (t.due != null && t.due !== "" && !isValidDay(t.due)) {
    return "task.due is not a valid date";
  }
  if (t.recurrence != null && t.recurrence !== "" && !RECURRENCE.has(t.recurrence)) {
    return `bad recurrence: ${t.recurrence}`;
  }
  if (t.estMin != null && (!Number.isFinite(Number(t.estMin)) || Number(t.estMin) < 0)) {
    return "task.estMin must be a non-negative number";
  }
  return null;
}

// ── "not today" skips ───────────────────────────────────────────────────────────
// Transient, per-day UI state (not part of the saved model): which plan items the
// user pushed off today. Stored as a single { day, keys } so it self-expires — a new
// day starts with a clean slate.
export function getPlanSkips(day) {
  const m = getMeta("planSkips", null);
  return m && m.day === day ? m.keys || [] : [];
}

export function setPlanSkip(day, kind, id, on = true) {
  const key = `${kind}:${id}`;
  const m = getMeta("planSkips", null);
  let keys = m && m.day === day ? [...m.keys] : [];
  if (on) {
    if (!keys.includes(key)) {
      keys.push(key);
    }
  } else {
    keys = keys.filter((k) => k !== key);
  }
  setMeta("planSkips", { day, keys });
  return keys;
}

// ── full state assembly (what GET /api/state returns) ───────────────────────────
/**
 * Assemble the unified model from the normalized tables (flat arrays) — WITHOUT
 * the completions log. The log is append-only, server-owned history that grows
 * forever; shipping it on GET /api/state and on every write response made each
 * checkbox toggle download the whole history (and the client never reads it —
 * streaks/heatmap come precomputed from /api/momentum). Use getFullState() where
 * history genuinely belongs in the payload (export/import round-trips).
 */
export function getState() {
  return {
    rev: getRev(),
    roadmaps: db
      .prepare(
        "SELECT id, title, source_url AS sourceUrl, color, archived, position, created_at AS createdAt, target_date AS targetDate, step_minutes AS stepMinutes FROM roadmaps ORDER BY position, created_at",
      )
      .all()
      .map((r) => ({ ...r, archived: !!r.archived })),
    milestones: db
      .prepare(
        "SELECT id, roadmap_id AS roadmapId, title, position FROM milestones ORDER BY position",
      )
      .all(),
    steps: db
      .prepare(
        "SELECT id, milestone_id AS milestoneId, title, status, position, resource_url AS resourceUrl, notes, done_at AS doneAt FROM steps ORDER BY position",
      )
      .all(),
    projects: db
      .prepare(
        "SELECT id, title, status, repo_url AS repoUrl, summary, position, created_at AS createdAt, shipped_at AS shippedAt FROM projects ORDER BY position, created_at",
      )
      .all(),
    tasks: db
      .prepare(
        "SELECT id, title, status, due, recurrence, step_id AS stepId, project_id AS projectId, est_min AS estMin, position, notes, created_at AS createdAt, done_at AS doneAt FROM tasks ORDER BY position, created_at",
      )
      .all(),
    profile: getMeta("profile", DEFAULT_PROFILE),
    settings: getMeta("settings", DEFAULT_SETTINGS),
  };
}

/** The whole append-only completion log, oldest first. */
function getCompletions() {
  return db.prepare("SELECT id, day, kind, ref_id AS refId, ts FROM completions ORDER BY ts").all();
}

/**
 * The unified model *including* the full completion log. For GET /api/export /
 * POST /api/import responses (a backup must carry your streak history) and for
 * the server-side computations (streaks, pacing, review) that read history.
 * Everyday reads and write responses use getState() — see its doc comment.
 */
export function getFullState() {
  return { ...getState(), completions: getCompletions() };
}

// ── lean writes (the common daily interactions — no full-state PUT) ─────────────
// Explicit pick-list: bind exactly the known columns. Spreading `{...defaults, ...t}`
// let unknown extra keys (or an explicit `undefined`) reach the SQL layer, where
// they throw generic bind errors instead of being harmlessly ignored.
function pickTask(t, nowIso) {
  return {
    id: t.id,
    title: t.title,
    status: t.status ?? "todo",
    due: t.due ?? null,
    recurrence: t.recurrence ?? null,
    stepId: t.stepId ?? null,
    projectId: t.projectId ?? null,
    estMin: t.estMin ?? null,
    position: t.position ?? 0,
    notes: t.notes ?? null,
    createdAt: t.createdAt ?? nowIso,
    doneAt: t.doneAt ?? null,
  };
}

/**
 * Append a single task and bump the rev. Cheaper than re-sending the whole state.
 * @returns {Object} the fresh state (sans completions log — see getState)
 */
export function addTask(t) {
  db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT INTO tasks(id,title,status,due,recurrence,step_id,project_id,est_min,position,notes,created_at,done_at)
       VALUES(@id,@title,@status,@due,@recurrence,@stepId,@projectId,@estMin,@position,@notes,@createdAt,@doneAt)`,
    ).run(pickTask(t, new Date().toISOString()));
    bumpRev();
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return getState();
}

/**
 * Toggle completion of a task or a step. Updates the item's current status +
 * done_at (for display) AND records/removes an entry in the append-only
 * `completions` log for the local day, which is what streaks/heatmap read. This is
 * why a daily recurring habit accumulates history instead of overwriting one column.
 * @param {"task"|"step"} kind
 * @param {string} id
 * @param {boolean} done
 * @param {string} [now] ISO timestamp (injectable for tests)
 * @returns {Object} the fresh state (sans completions log — see getState)
 */
export function setDone(kind, id, done, now = new Date().toISOString()) {
  const table = kind === "step" ? "steps" : "tasks";
  const day = localDay(now); // bucket by the local day (shared with the engine)
  db.exec("BEGIN");
  try {
    const status = done ? "done" : "todo";
    const doneAt = done ? now : null;
    const res = db
      .prepare(`UPDATE ${table} SET status = ?, done_at = ? WHERE id = ?`)
      .run(status, doneAt, id);
    if (res.changes === 0) {
      throw new Error(`${kind} not found: ${id}`);
    }
    if (done) {
      // one completion per item per local day (UNIQUE makes re-completes a no-op)
      db.prepare(
        "INSERT OR IGNORE INTO completions(id, day, kind, ref_id, ts) VALUES(?, ?, ?, ?, ?)",
      ).run(newId(), day, kind, id, now);
    } else {
      // undo only retracts today's credit, not historical days you already earned
      db.prepare("DELETE FROM completions WHERE kind = ? AND ref_id = ? AND day = ?").run(
        kind,
        id,
        day,
      );
    }
    bumpRev();
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return getState();
}

// ── full state replace (PUT /api/state) ─────────────────────────────────────────
function replaceAll(state) {
  // children first (FKs), though ON DELETE CASCADE would handle it
  db.prepare("DELETE FROM tasks").run();
  db.prepare("DELETE FROM steps").run();
  db.prepare("DELETE FROM milestones").run();
  db.prepare("DELETE FROM roadmaps").run();
  db.prepare("DELETE FROM projects").run();

  const ins = {
    roadmap: db.prepare(
      "INSERT INTO roadmaps(id,title,source_url,color,archived,position,created_at,target_date,step_minutes) VALUES(@id,@title,@sourceUrl,@color,@archived,@position,@createdAt,@targetDate,@stepMinutes)",
    ),
    milestone: db.prepare(
      "INSERT INTO milestones(id,roadmap_id,title,position) VALUES(@id,@roadmapId,@title,@position)",
    ),
    step: db.prepare(
      "INSERT INTO steps(id,milestone_id,title,status,position,resource_url,notes,done_at) VALUES(@id,@milestoneId,@title,@status,@position,@resourceUrl,@notes,@doneAt)",
    ),
    project: db.prepare(
      "INSERT INTO projects(id,title,status,repo_url,summary,position,created_at,shipped_at) VALUES(@id,@title,@status,@repoUrl,@summary,@position,@createdAt,@shippedAt)",
    ),
    task: db.prepare(
      "INSERT INTO tasks(id,title,status,due,recurrence,step_id,project_id,est_min,position,notes,created_at,done_at) VALUES(@id,@title,@status,@due,@recurrence,@stepId,@projectId,@estMin,@position,@notes,@createdAt,@doneAt)",
    ),
  };

  // pick-lists throughout (see pickTask): unknown extra keys must be stripped,
  // never handed to the SQL layer where they throw generic bind errors
  const nowIso = new Date().toISOString();
  for (const r of state.roadmaps || []) {
    ins.roadmap.run({
      id: r.id,
      title: r.title,
      sourceUrl: r.sourceUrl ?? null,
      color: r.color ?? null,
      archived: r.archived ? 1 : 0, // coerce bool → 0/1 for the INTEGER column
      position: r.position ?? 0,
      createdAt: r.createdAt ?? nowIso,
      targetDate: r.targetDate ?? null,
      stepMinutes: r.stepMinutes ?? null,
    });
  }
  for (const m of state.milestones || []) {
    ins.milestone.run({
      id: m.id,
      roadmapId: m.roadmapId,
      title: m.title,
      position: m.position ?? 0,
    });
  }
  for (const s of state.steps || []) {
    ins.step.run({
      id: s.id,
      milestoneId: s.milestoneId,
      title: s.title,
      status: s.status ?? "todo",
      position: s.position ?? 0,
      resourceUrl: s.resourceUrl ?? null,
      notes: s.notes ?? null,
      doneAt: s.doneAt ?? null,
    });
  }
  for (const p of state.projects || []) {
    ins.project.run({
      id: p.id,
      title: p.title,
      status: p.status ?? "idea",
      repoUrl: p.repoUrl ?? null,
      summary: p.summary ?? null,
      position: p.position ?? 0,
      createdAt: p.createdAt ?? nowIso,
      shippedAt: p.shippedAt ?? null,
    });
  }
  for (const t of state.tasks || []) {
    ins.task.run(pickTask(t, nowIso));
  }

  if (state.profile) {
    setMeta("profile", state.profile);
  }
  if (state.settings) {
    setMeta("settings", state.settings);
  }
}

// node:sqlite has no .transaction() helper — wrap manually so a bad PUT can't
// leave the tables half-written. `expectedRev` enables optimistic concurrency.
export class ConflictError extends Error {}

/**
 * Replace the full state inside a transaction, bumping the rev. The completions
 * log is deliberately untouched (see replaceCompletions): a `completions` key in
 * the incoming body is simply ignored.
 * @param {number} [expectedRev] - if set and stale, throws ConflictError
 * @returns {Object} the fresh state (sans completions log — see getState)
 */
export function putState(state, expectedRev) {
  if (expectedRev != null && Number(expectedRev) !== getRev()) {
    throw new ConflictError("state changed since you loaded it");
  }
  db.exec("BEGIN");
  try {
    replaceAll(state);
    bumpRev();
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return getState();
}

/**
 * Erase everything — all rows + the saved profile/settings — and start fresh.
 * @returns {Object} the fresh (empty) state (sans completions log — see getState)
 */
export function resetAll() {
  db.exec("BEGIN");
  try {
    for (const t of ["tasks", "steps", "milestones", "roadmaps", "projects", "completions"]) {
      db.prepare(`DELETE FROM ${t}`).run();
    }
    db.prepare("DELETE FROM meta WHERE key IN ('profile', 'settings', 'planSkips')").run();
    bumpRev();
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return getState();
}

/** Inner worker for completion-log rebuilds — the caller owns the transaction. */
function writeCompletionRows(rows = []) {
  db.prepare("DELETE FROM completions").run();
  const ins = db.prepare(
    "INSERT OR IGNORE INTO completions(id, day, kind, ref_id, ts) VALUES(@id, @day, @kind, @refId, @ts)",
  );
  for (const c of rows) {
    // skip malformed rows rather than fail the whole import
    if (!c?.day || !c?.kind || !c?.refId) {
      continue;
    }
    if (!isValidDay(c.day) || !COMPLETION_KINDS.has(c.kind)) {
      continue; // a garbage day would poison streak math; unknown kinds mean nothing
    }
    const id = typeof c.id === "string" && c.id ? c.id : newId();
    const ts =
      (typeof c.ts === "string" && c.ts) || (typeof c.ts === "number" && Number.isFinite(c.ts))
        ? c.ts
        : c.day; // non-bindable / missing ts → fall back to the day
    ins.run({ id, day: c.day, kind: c.kind, refId: c.refId, ts });
  }
}

/**
 * Replace the whole completion log from an array of rows. The everyday full-state
 * PUT deliberately leaves completions untouched (they're server-owned history that
 * client edits must never clobber); only a backup *import* rebuilds them, so a
 * restored backup brings your streak history back with it.
 * @returns {Object} the fresh full state incl. the rebuilt completions log
 */
export function replaceCompletions(rows = []) {
  db.exec("BEGIN");
  try {
    writeCompletionRows(rows);
    bumpRev();
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return getFullState();
}

/**
 * Backup import: replace the whole model AND the completion log in ONE
 * transaction. Running them as two separate transactions meant a failure in the
 * second half-applied the import (new tables, old history) while reporting an
 * error — the rollback here covers both.
 * @returns {Object} the fresh full state incl. the imported completions log
 */
export function importAll(state) {
  db.exec("BEGIN");
  try {
    replaceAll(state);
    writeCompletionRows(state.completions || []);
    bumpRev();
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return getFullState();
}

export { DEFAULT_PROFILE, DEFAULT_SETTINGS };
