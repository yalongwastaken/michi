// db.js — SQLite schema + accessors for Michi's unified data model.
// Single-user, single SQLite file. Uses Node's built-in node:sqlite — no native
// build step, nothing to compile on the mini PC. (Run node with --experimental-sqlite.)
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.MICHI_DB || join(__dirname, "data", "michi.db");

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
  -- a learning path: a roadmap.sh-style track, a GitHub roadmap, a course, a book…
  CREATE TABLE IF NOT EXISTS roadmaps (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL,
    source_url TEXT,                 -- where it came from (roadmap.sh, a GH repo, …)
    color      TEXT,
    archived   INTEGER NOT NULL DEFAULT 0,
    position   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
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
};

const STEP_STATUS = new Set(["todo", "doing", "done"]);
const TASK_STATUS = new Set(["todo", "doing", "done"]);
const PROJECT_STATUS = new Set(["idea", "active", "shipped"]);
const RECURRENCE = new Set(["daily", "weekdays", "weekly"]);

/** Local YYYY-MM-DD for an ISO timestamp — the mini PC runs in the user's tz. */
function localDayKey(iso) {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

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
  for (const k of ["roadmaps", "milestones", "steps", "projects", "tasks", "completions"]) {
    if (s[k] != null && !Array.isArray(s[k])) {
      return `${k} must be an array`;
    }
  }
  for (const r of s.roadmaps || []) {
    if (!r?.id || !r?.title) {
      return "roadmap needs an id and title";
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
  // a garbage due date would persist and silently skew the Today queue + streaks
  if (t.due != null && t.due !== "" && Number.isNaN(Date.parse(t.due))) {
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

// ── full state assembly (what GET /api/state returns) ───────────────────────────
/** Assemble the full unified model from the normalized tables (flat arrays). */
export function getState() {
  return {
    rev: getRev(),
    roadmaps: db
      .prepare(
        "SELECT id, title, source_url AS sourceUrl, color, archived, position, created_at AS createdAt FROM roadmaps ORDER BY position, created_at",
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
    completions: db
      .prepare("SELECT id, day, kind, ref_id AS refId, ts FROM completions ORDER BY ts")
      .all(),
    profile: getMeta("profile", DEFAULT_PROFILE),
    settings: getMeta("settings", DEFAULT_SETTINGS),
  };
}

// ── lean writes (the common daily interactions — no full-state PUT) ─────────────
/**
 * Append a single task and bump the rev. Cheaper than re-sending the whole state.
 * @returns {Object} the fresh full state
 */
export function addTask(t) {
  db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT INTO tasks(id,title,status,due,recurrence,step_id,project_id,est_min,position,notes,created_at,done_at)
       VALUES(@id,@title,@status,@due,@recurrence,@stepId,@projectId,@estMin,@position,@notes,@createdAt,@doneAt)`,
    ).run({
      status: "todo",
      due: null,
      recurrence: null,
      stepId: null,
      projectId: null,
      estMin: null,
      position: 0,
      notes: null,
      createdAt: new Date().toISOString(),
      doneAt: null,
      ...t,
    });
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
 * @returns {Object} the fresh full state
 */
export function setDone(kind, id, done, now = new Date().toISOString()) {
  const table = kind === "step" ? "steps" : "tasks";
  const day = localDayKey(now);
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
      "INSERT INTO roadmaps(id,title,source_url,color,archived,position,created_at) VALUES(@id,@title,@sourceUrl,@color,@archived,@position,@createdAt)",
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

  const nowIso = new Date().toISOString();
  for (const r of state.roadmaps || []) {
    ins.roadmap.run({
      sourceUrl: null,
      color: null,
      position: 0,
      createdAt: nowIso,
      ...r,
      archived: r.archived ? 1 : 0, // coerce bool → 0/1 for the INTEGER column
    });
  }
  for (const m of state.milestones || []) {
    ins.milestone.run({ position: 0, ...m });
  }
  for (const s of state.steps || []) {
    ins.step.run({
      status: "todo",
      position: 0,
      resourceUrl: null,
      notes: null,
      doneAt: null,
      ...s,
    });
  }
  for (const p of state.projects || []) {
    ins.project.run({
      status: "idea",
      repoUrl: null,
      summary: null,
      position: 0,
      createdAt: nowIso,
      shippedAt: null,
      ...p,
    });
  }
  for (const t of state.tasks || []) {
    ins.task.run({
      status: "todo",
      due: null,
      recurrence: null,
      stepId: null,
      projectId: null,
      estMin: null,
      position: 0,
      notes: null,
      createdAt: nowIso,
      doneAt: null,
      ...t,
    });
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
 * Replace the full state inside a transaction, bumping the rev.
 * @param {number} [expectedRev] - if set and stale, throws ConflictError
 * @returns {Object} the fresh full state
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
 * @returns {Object} the fresh (empty) state
 */
export function resetAll() {
  db.exec("BEGIN");
  try {
    for (const t of ["tasks", "steps", "milestones", "roadmaps", "projects", "completions"]) {
      db.prepare(`DELETE FROM ${t}`).run();
    }
    db.prepare("DELETE FROM meta WHERE key IN ('profile', 'settings')").run();
    bumpRev();
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return getState();
}

/**
 * Replace the whole completion log from an array of rows. The everyday full-state
 * PUT deliberately leaves completions untouched (they're server-owned history that
 * client edits must never clobber); only a backup *import* rebuilds them, so a
 * restored backup brings your streak history back with it.
 */
export function replaceCompletions(rows = []) {
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM completions").run();
    const ins = db.prepare(
      "INSERT OR IGNORE INTO completions(id, day, kind, ref_id, ts) VALUES(@id, @day, @kind, @refId, @ts)",
    );
    for (const c of rows) {
      if (!c?.day || !c?.kind || !c?.refId) {
        continue; // skip malformed rows rather than fail the whole import
      }
      ins.run({ id: c.id || newId(), day: c.day, kind: c.kind, refId: c.refId, ts: c.ts || c.day });
    }
    bumpRev();
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return getState();
}

export { DEFAULT_PROFILE, DEFAULT_SETTINGS };
