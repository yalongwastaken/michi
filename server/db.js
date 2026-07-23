// db.js — SQLite schema + accessors for Michi's unified data model.
// Single-user, single SQLite file. Uses Node's built-in node:sqlite — no native
// build step, nothing to compile on the mini PC. (Run node with --experimental-sqlite.)
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";
import { localDay } from "./dates.js";
import { setActivitySource, isClean } from "./engine.js";

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
    done_at      TEXT,                           -- ISO timestamp when marked done
    goal_id      TEXT                            -- optional attribution to an overarching
                                                 -- goal (no FK: a soft, forgiving link —
                                                 -- replaceAll nulls it if the goal is gone)
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
    shipped_at TEXT,
    roadmap_id TEXT                              -- optional link to the roadmap it applies
                                                 -- (no FK: migrated DBs can't add one via
                                                 -- ALTER TABLE — replaceAll nulls dangling
                                                 -- refs instead, on every DB alike)
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
    done_at     TEXT,                            -- ISO timestamp when last completed
    goal_id     TEXT                             -- optional attribution to an overarching
                                                 -- goal (no FK: a soft, forgiving link —
                                                 -- replaceAll nulls it if the goal is gone)
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

  -- kata (型): daily self-regulation forms — greyscale phone, shutdown ritual…
  -- Practiced, not completed: honoring one logs a completions row (kind "kata")
  -- but the daily goal and the streak deliberately never count them (engine.js).
  -- At most 5 may be active at once (enforced in validateState — a dōjō, not a
  -- checklist). builtin_id points into server/kata.js's library; null = custom.
  CREATE TABLE IF NOT EXISTS kata (
    id         TEXT PRIMARY KEY,                  -- kata_-prefixed uid
    title      TEXT NOT NULL,
    note       TEXT,
    builtin_id TEXT,                              -- KATA_LIBRARY id, null for custom
    active     INTEGER NOT NULL DEFAULT 1,
    position   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  -- the kata honor ledger, one row per local day that saw any honoring.
  -- active_ids is a snapshot of the active set taken at the FIRST honor of the
  -- day; honored_ids follows the toggle. A day is "clean" when the snapshot was
  -- honored in full — the snapshot wins over later edits to the active set
  -- (engine.isClean). History like completions: exported, imported, never PUT.
  CREATE TABLE IF NOT EXISTS kata_days (
    day         TEXT PRIMARY KEY,                 -- local YYYY-MM-DD
    active_ids  TEXT NOT NULL,                    -- JSON array of kata ids
    honored_ids TEXT NOT NULL                     -- JSON array of kata ids
  );

  -- the daily journal / time log: what actually happened. One row per logged
  -- entry, bucketed by local day, optionally with a start/end (minutes from
  -- midnight) so it can render on a Google-Calendar-style timeline. Untimed
  -- entries (start/end null) are "did this" notes. Links to a project/step are
  -- soft (no FK) — the log of what you did outlives the thing it referenced.
  -- History like completions: exported/imported for backup, never in the PUT.
  CREATE TABLE IF NOT EXISTS journal (
    id         TEXT PRIMARY KEY,                 -- jr_-prefixed uid
    day        TEXT NOT NULL,                    -- local YYYY-MM-DD
    start_min  INTEGER,                          -- minutes from midnight (0..1439), null = untimed
    end_min    INTEGER,                          -- minutes from midnight, null = untimed/open
    title      TEXT NOT NULL,
    note       TEXT,
    project_id TEXT,                             -- optional soft link
    step_id    TEXT,                             -- optional soft link
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_journal_day ON journal(day);

  -- overarching goals: the long-horizon aspirations that sit ABOVE roadmaps and
  -- week plans ("climb V10", "Japanese N1"). You set one, then attribute completed
  -- tasks/steps to it (tasks.goal_id / steps.goal_id) so the accumulated work reads
  -- as steady progress. Part of the editable model (rides the everyday PUT), so no
  -- FK from the linked items back to here — replaceAll nulls dangling goal_ids.
  CREATE TABLE IF NOT EXISTS goals (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    area        TEXT,                            -- optional grouping ("Japanese", "Climbing")
    note        TEXT,
    color       TEXT,
    status      TEXT NOT NULL DEFAULT 'active',  -- active | achieved
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    achieved_at TEXT                             -- ISO timestamp when marked achieved
  );

  -- week plans: the overarching weekly layer between goals and the daily plan. One
  -- row per focus area per week — weekly targets (a checklist) plus a per-weekday
  -- split of intent. Claude drafts these (server/weekplan.js), then a day's slice is
  -- refined into concrete tasks. Soft links to a roadmap/goal (no FK; nulled if gone).
  CREATE TABLE IF NOT EXISTS week_plans (
    id          TEXT PRIMARY KEY,
    week_start  TEXT NOT NULL,                   -- the Monday it covers (local YYYY-MM-DD)
    area        TEXT NOT NULL,                   -- focus area label ("Japanese", "Climbing")
    title       TEXT,                            -- optional display title
    theme       TEXT,                            -- one calm line of intent for the week
    roadmap_id  TEXT,                            -- optional soft link to a roadmap
    goal_id     TEXT,                            -- optional soft link to an overarching goal
    targets     TEXT NOT NULL DEFAULT '[]',      -- JSON: [{ text, done }]
    days        TEXT NOT NULL DEFAULT '{}',      -- JSON: { mon: { focus, minutes }, … }
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_week_plans_start ON week_plans(week_start);

  -- flexible JSON blobs for the evolving profile + settings + rev
  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL                          -- JSON
  );

  -- soft-delete safety net: the full-state PUT snapshots whatever disappears from
  -- it (see putState) so an accidental delete can be undone. A roadmap row carries
  -- its whole subtree in the payload. Deliberately no FKs — trash must outlive
  -- everything it references — and deliberately NOT part of the model/export:
  -- it's a recovery net, not state (see getFullState).
  CREATE TABLE IF NOT EXISTS trash (
    id         TEXT PRIMARY KEY,                 -- tr_-prefixed uid
    kind       TEXT NOT NULL,                    -- roadmap | step | project | task | kata | goal | weekPlan
    title      TEXT NOT NULL,                    -- for the trash listing
    payload    TEXT NOT NULL,                    -- JSON snapshot (getState shapes)
    deleted_at TEXT NOT NULL                     -- ISO timestamp, drives retention
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

// migrate older DBs that predate the project → roadmap link
{
  const cols = db
    .prepare("PRAGMA table_info(projects)")
    .all()
    .map((c) => c.name);
  if (!cols.includes("roadmap_id")) {
    db.exec("ALTER TABLE projects ADD COLUMN roadmap_id TEXT");
  }
}

// migrate older DBs that predate the overarching-goal attribution links
for (const table of ["tasks", "steps"]) {
  const cols = db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((c) => c.name);
  if (!cols.includes("goal_id")) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN goal_id TEXT`);
  }
}

// ── defaults ──────────────────────────────────────────────────────────────────
const DEFAULT_PROFILE = {
  name: "",
  focusAreas: [], // freeform tags the user is investing in right now
  onboarded: false,
  mascot: "shiba", // which companion walks the path (see MASCOT_SPECIES)
};

// the nine companions the client's Mascot engine knows how to draw — an unknown id
// would render as a silent shiba fallback forever, so reject it at the door instead
const MASCOT_SPECIES = new Set([
  "shiba",
  "panda",
  "daruma",
  "kitsune",
  "tanuki",
  "raccoon",
  "maneki",
  "rabbit",
  "crane",
]);
const DEFAULT_SETTINGS = {
  theme: "system", // system | light | dark
  // how hard the user is pushing — a preset that sets the four goal numbers below.
  // easy | steady | focused | intense | custom (see client/src/lib/intensity.js).
  // The numbers stay the source of truth for the engine/planner; intensity is the
  // label the UI shows and the export prompt speaks.
  intensity: "steady",
  dailyGoal: 3, // completions/day that count as "hit your goal"
  weeklyGoal: 15, // completions/week the "This week" card aims for
  weeklyActiveDays: 5, // active days/week the user aims to show up
  streakFreezes: 2, // missed days the streak can bridge before it breaks
  dailyMinutes: 60, // the planner's daily time budget
  defaultStepMin: 30, // assumed effort for a roadmap step with no estimate
  taskDefaultMin: 20, // assumed effort for a task with no estimate
};

// trash retention: a safety net, not an archive — old snapshots age out and the
// table stays small enough to list in full. Enforced at boot + after every insert.
const TRASH_RETENTION_DAYS = 30; // rows older than this are purged
// generous cap: one mass delete (a big roadmap wipe, an "empty the backlog"
// sweep) can insert dozens of rows in a single diff — a tight cap would let that
// burst evict the safety net under EARLIER deletes the user may still regret
const TRASH_MAX_ROWS = 200; // …and only the newest N are kept

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
const GOAL_STATUS = new Set(["active", "achieved"]);
const RECURRENCE = new Set(["daily", "weekdays", "weekly"]);
const COMPLETION_KINDS = new Set(["task", "step", "kata"]);
// the seven weekday keys a week plan's day-split may carry (Mon-first, local week)
const WEEKDAY_KEYS = new Set(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);

// sane bounds for the numeric settings — a huge/Infinity streakFreezes would make
// computeStreak() walk back day-by-day (nearly) forever and wedge the event loop
const SETTING_RANGES = {
  dailyGoal: [0, 1000], // 0 is valid "rest mode"
  weeklyGoal: [0, 10000],
  weeklyActiveDays: [0, 7],
  streakFreezes: [0, 365],
  dailyMinutes: [0, 1440],
  defaultStepMin: [0, 1440],
  taskDefaultMin: [0, 1440],
};

const newId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

// prefixed ids (trash rows, restore remaps) — the same shape the client mints
// (client/src/lib/uid.js); markdown.js carries its own copy for the same reason
const uid = (prefix) => `${prefix}_${newId().slice(0, 8)}`;

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

// ── web-push + focus reminders (opt-in notifications; see focus.js) ─────────────
// All live in the meta table as JSON. They're device registrations / ephemeral
// timers, not model data, so resetAll() deliberately leaves them alone (it only
// clears profile/settings/planSkips) — unsubscribing a device is the way to clear.
export function getVapid() {
  return getMeta("vapid", null);
}
export function setVapid(keys) {
  setMeta("vapid", keys);
}
export function getPushSubs() {
  return getMeta("pushSubs", []);
}
export function setPushSubs(subs) {
  setMeta("pushSubs", subs);
}
/** Pending focus-block reminders: [{ id, dueAt(ms), title, body }]. */
export function getFocusReminders() {
  return getMeta("focusReminders", []);
}
export function setFocusReminders(list) {
  setMeta("focusReminders", list);
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
  // `completions`/`kataDays` may be present (import validates + rebuilds the
  // history) or absent — the everyday PUT ignores both keys entirely, so a client
  // that never saw them (GET /api/state doesn't ship them) still validates cleanly
  for (const k of [
    "roadmaps",
    "milestones",
    "steps",
    "projects",
    "tasks",
    "kata",
    "goals",
    "weekPlans",
    "completions",
    "kataDays",
    "journal",
  ]) {
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
  for (const k of s.kata || []) {
    if (!k?.id) {
      return "kata needs an id";
    }
    if (!k.title || !String(k.title).trim()) {
      return "kata needs a title";
    }
    // bool-ish only: a truthy string like "no" flipping a kata ACTIVE would be
    // a silent surprise — reject anything that isn't a clear boolean/0/1
    if (k.active != null && typeof k.active !== "boolean" && k.active !== 0 && k.active !== 1) {
      return "kata.active must be a boolean";
    }
  }
  for (const g of s.goals || []) {
    if (!g?.id || !g?.title) {
      return "goal needs an id and title";
    }
    if (g.status != null && !GOAL_STATUS.has(g.status)) {
      return `bad goal status: ${g.status}`;
    }
  }
  for (const w of s.weekPlans || []) {
    if (!w?.id) {
      return "week plan needs an id";
    }
    if (!isValidDay(w.weekStart)) {
      return "week plan needs a valid weekStart (YYYY-MM-DD)";
    }
    if (!w.area || !String(w.area).trim()) {
      return "week plan needs an area";
    }
    if (w.targets != null && !Array.isArray(w.targets)) {
      return "week plan targets must be an array";
    }
    if (w.days != null && (typeof w.days !== "object" || Array.isArray(w.days))) {
      return "week plan days must be an object keyed by weekday";
    }
    for (const key of Object.keys(w.days || {})) {
      if (!WEEKDAY_KEYS.has(key)) {
        return `bad week plan day key: ${key}`;
      }
    }
  }
  // kata_days rows only arrive via import — validate just enough that the
  // clean-day math can't be poisoned (a garbage day, non-array id lists)
  for (const kd of s.kataDays || []) {
    if (!kd || typeof kd !== "object") {
      return "kataDays rows must be objects";
    }
    if (!isValidDay(kd.day)) {
      return "kataDays rows need a valid day (YYYY-MM-DD)";
    }
    if (!Array.isArray(kd.activeIds) || !Array.isArray(kd.honoredIds)) {
      return "kataDays rows need activeIds and honoredIds arrays";
    }
  }
  // journal rows arrive via import/backup — validate just enough to keep the
  // timeline math sane (a valid day, a title, minute fields in range and ordered)
  for (const e of s.journal || []) {
    if (!e || typeof e !== "object") {
      return "journal rows must be objects";
    }
    if (!isValidDay(e.day)) {
      return "journal rows need a valid day (YYYY-MM-DD)";
    }
    if (!e.title || !String(e.title).trim()) {
      return "journal rows need a title";
    }
    for (const f of ["startMin", "endMin"]) {
      const v = e[f];
      if (v != null && (!Number.isFinite(Number(v)) || Number(v) < 0 || Number(v) > 1440)) {
        return `journal.${f} must be minutes between 0 and 1440`;
      }
    }
    if (e.startMin != null && e.endMin != null && Number(e.endMin) < Number(e.startMin)) {
      return "journal end must be at or after start";
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
    ["kata", "kata"],
    ["goals", "goal"],
    ["weekPlans", "week plan"],
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
  for (const p of s.projects || []) {
    if (p.roadmapId && !roadmapIds.has(p.roadmapId)) {
      return `project "${p.id}" references missing roadmap "${p.roadmapId}"`;
    }
  }
  if (s.profile != null) {
    if (typeof s.profile !== "object" || Array.isArray(s.profile)) {
      return "profile must be an object";
    }
    if (s.profile.name != null && typeof s.profile.name !== "string") {
      return "profile.name must be a string";
    }
    if (s.profile.mascot != null && !MASCOT_SPECIES.has(s.profile.mascot)) {
      return `profile.mascot must be one of: ${[...MASCOT_SPECIES].join(", ")}`;
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
        "SELECT id, milestone_id AS milestoneId, title, status, position, resource_url AS resourceUrl, notes, done_at AS doneAt, goal_id AS goalId FROM steps ORDER BY position",
      )
      .all(),
    projects: db
      .prepare(
        "SELECT id, title, status, repo_url AS repoUrl, summary, position, created_at AS createdAt, shipped_at AS shippedAt, roadmap_id AS roadmapId FROM projects ORDER BY position, created_at",
      )
      .all(),
    tasks: db
      .prepare(
        "SELECT id, title, status, due, recurrence, step_id AS stepId, project_id AS projectId, est_min AS estMin, position, notes, created_at AS createdAt, done_at AS doneAt, goal_id AS goalId FROM tasks ORDER BY position, created_at",
      )
      .all(),
    kata: db
      .prepare(
        "SELECT id, title, note, builtin_id AS builtinId, active, position, created_at AS createdAt FROM kata ORDER BY position, created_at",
      )
      .all()
      .map((k) => ({ ...k, active: !!k.active })),
    goals: db
      .prepare(
        "SELECT id, title, area, note, color, status, position, created_at AS createdAt, achieved_at AS achievedAt FROM goals ORDER BY position, created_at",
      )
      .all(),
    weekPlans: db
      .prepare(
        "SELECT id, week_start AS weekStart, area, title, theme, roadmap_id AS roadmapId, goal_id AS goalId, targets, days, position, created_at AS createdAt FROM week_plans ORDER BY week_start DESC, position, created_at",
      )
      .all()
      .map((w) => ({
        ...w,
        targets: parseJsonArr(w.targets),
        days: parseJsonObj(w.days),
      })),
    profile: getMeta("profile", DEFAULT_PROFILE),
    settings: getMeta("settings", DEFAULT_SETTINGS),
  };
}

// week-plan JSON columns come out of SQLite as strings; parse defensively so one
// corrupt row can't throw the whole getState (→ every read + write response)
function parseJsonArr(s) {
  try {
    const v = JSON.parse(s ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function parseJsonObj(s) {
  try {
    const v = JSON.parse(s ?? "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/** The whole append-only completion log, oldest first. */
function getCompletions() {
  return db.prepare("SELECT id, day, kind, ref_id AS refId, ts FROM completions ORDER BY ts").all();
}

/** The whole kata honor ledger, oldest first (id arrays parsed out of JSON). */
function getKataDays() {
  return db
    .prepare("SELECT day, active_ids, honored_ids FROM kata_days ORDER BY day")
    .all()
    .map((r) => ({
      day: r.day,
      activeIds: JSON.parse(r.active_ids),
      honoredIds: JSON.parse(r.honored_ids),
    }));
}

// ── journal / time log ──────────────────────────────────────────────────────────
const INS_JOURNAL =
  "INSERT INTO journal(id,day,start_min,end_min,title,note,project_id,step_id,created_at) " +
  "VALUES(@id,@day,@start_min,@end_min,@title,@note,@project_id,@step_id,@created_at)";
const journalRow = (r) =>
  r && {
    id: r.id,
    day: r.day,
    startMin: r.start_min,
    endMin: r.end_min,
    title: r.title,
    note: r.note,
    projectId: r.project_id,
    stepId: r.step_id,
    createdAt: r.created_at,
  };
// order for a timeline: by day, then timed-before-untimed, then start, then insert
const JOURNAL_ORDER = "ORDER BY day, start_min IS NULL, start_min, created_at";
const asMin = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/** Journal entries within [from, to] (inclusive), ordered for a timeline. */
export function getJournalRange(from, to) {
  return db
    .prepare(`SELECT * FROM journal WHERE day >= ? AND day <= ? ${JOURNAL_ORDER}`)
    .all(from, to)
    .map(journalRow);
}

/** The whole journal, oldest first — for export/backup only (grows over time). */
function getJournal() {
  return db.prepare(`SELECT * FROM journal ${JOURNAL_ORDER}`).all().map(journalRow);
}

/** Insert a journal entry; returns the stored row. */
export function addJournalEntry(e) {
  const row = {
    id: uid("jr"),
    day: e.day,
    start_min: asMin(e.startMin),
    end_min: asMin(e.endMin),
    title: String(e.title).trim(),
    note: e.note ?? null,
    project_id: e.projectId ?? null,
    step_id: e.stepId ?? null,
    created_at: new Date().toISOString(),
  };
  db.prepare(INS_JOURNAL).run(row);
  return journalRow(db.prepare("SELECT * FROM journal WHERE id = ?").get(row.id));
}

/** Patch an entry (only provided fields). Returns the updated row, or null if gone. */
export function updateJournalEntry(id, patch = {}) {
  const cur = db.prepare("SELECT * FROM journal WHERE id = ?").get(id);
  if (!cur) {
    return null;
  }
  const next = {
    id,
    day: patch.day ?? cur.day,
    start_min: patch.startMin !== undefined ? asMin(patch.startMin) : cur.start_min,
    end_min: patch.endMin !== undefined ? asMin(patch.endMin) : cur.end_min,
    title: patch.title !== undefined ? String(patch.title).trim() : cur.title,
    note: patch.note !== undefined ? patch.note : cur.note,
    project_id: patch.projectId !== undefined ? patch.projectId : cur.project_id,
    step_id: patch.stepId !== undefined ? patch.stepId : cur.step_id,
  };
  db.prepare(
    "UPDATE journal SET day=@day,start_min=@start_min,end_min=@end_min,title=@title," +
      "note=@note,project_id=@project_id,step_id=@step_id WHERE id=@id",
  ).run(next);
  return journalRow(db.prepare("SELECT * FROM journal WHERE id = ?").get(id));
}

/** Delete an entry; true if a row was removed. */
export function deleteJournalEntry(id) {
  return db.prepare("DELETE FROM journal WHERE id = ?").run(id).changes > 0;
}

// import/backup: replace the whole journal (skips malformed rows, like completions)
function writeJournalRows(rows = []) {
  db.prepare("DELETE FROM journal").run();
  const ins = db.prepare(INS_JOURNAL.replace("INSERT INTO", "INSERT OR IGNORE INTO"));
  for (const e of rows) {
    if (!e || !isValidDay(e.day) || !e.title || !String(e.title).trim()) {
      continue;
    }
    ins.run({
      id: typeof e.id === "string" && e.id ? e.id : uid("jr"),
      day: e.day,
      start_min: asMin(e.startMin),
      end_min: asMin(e.endMin),
      title: String(e.title).trim(),
      note: e.note ?? null,
      project_id: e.projectId ?? null,
      step_id: e.stepId ?? null,
      created_at:
        typeof e.createdAt === "string" && e.createdAt ? e.createdAt : new Date().toISOString(),
    });
  }
}

// ── in-memory activity summary (what momentum reads instead of the raw log) ─────
// The completions log is unbounded and append-only, and every dashboard request
// used to re-aggregate all of it. Keep a small day→{tasks,steps} counter map (plus
// lifetime totals) in memory instead: built lazily from one GROUP BY, nudged
// incrementally by the toggle path, and dropped whenever the log is rewritten
// wholesale (import / restore / reset) so the next read rebuilds from scratch.
let activityCache = null;

const kindKey = (kind) => (kind === "step" ? "steps" : kind === "kata" ? "kata" : "tasks");

function buildActivityCache() {
  const byDay = new Map();
  const totals = { tasks: 0, steps: 0, kata: 0 };
  const rows = db
    .prepare("SELECT day, kind, COUNT(*) AS n FROM completions GROUP BY day, kind")
    .all();
  for (const { day, kind, n } of rows) {
    const key = kindKey(kind);
    const rec = byDay.get(day) || { tasks: 0, steps: 0, kata: 0 };
    rec[key] += n;
    totals[key] += n;
    byDay.set(day, rec);
  }
  return { byDay, totals };
}

/** Day → {tasks, steps, kata} counts + lifetime totals, cached across requests. */
export function getActivitySummary() {
  if (!activityCache) {
    activityCache = buildActivityCache();
  }
  return activityCache;
}

/** Nudge the cache after a COMMITTED log insert/delete (no-op while unbuilt —
 * the first read scans the fresh rows anyway). Never call before the commit:
 * a rollback must leave the cache matching the untouched tables. */
function bumpActivity(day, kind, delta) {
  if (!activityCache) {
    return;
  }
  const key = kindKey(kind);
  const rec = activityCache.byDay.get(day) || { tasks: 0, steps: 0, kata: 0 };
  rec[key] += delta;
  activityCache.totals[key] += delta;
  if (rec.tasks <= 0 && rec.steps <= 0 && rec.kata <= 0) {
    activityCache.byDay.delete(day); // an empty day must not count as "active"
  } else {
    activityCache.byDay.set(day, rec);
  }
}

/** The log was rewritten wholesale — drop the cache and rebuild on next read. */
function dropActivityCache() {
  activityCache = null;
}

/**
 * The unified model *including* the full completion log. For GET /api/export /
 * POST /api/import responses (a backup must carry your streak history) and for
 * the server-side computations (streaks, pacing, review) that read history.
 * Everyday reads and write responses use getState() — see its doc comment.
 * The trash table is deliberately NOT here (so not in export/import either):
 * it's a safety net for accidental deletes, not model state — a backup that
 * carried it would "restore" old deletions into a dataset that moved on.
 */
export function getFullState() {
  return {
    ...getState(),
    completions: getCompletions(),
    kataDays: getKataDays(),
    journal: getJournal(),
  };
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
    goalId: t.goalId ?? null,
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
      `INSERT INTO tasks(id,title,status,due,recurrence,step_id,project_id,est_min,position,notes,created_at,done_at,goal_id)
       VALUES(@id,@title,@status,@due,@recurrence,@stepId,@projectId,@estMin,@position,@notes,@createdAt,@doneAt,@goalId)`,
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
  let logged = 0; // net completion-log rows added (+1) / removed (-1) this call
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
      const ins = db
        .prepare(
          "INSERT OR IGNORE INTO completions(id, day, kind, ref_id, ts) VALUES(?, ?, ?, ?, ?)",
        )
        .run(newId(), day, kind, id, now);
      logged = Number(ins.changes); // 0 on a same-day re-complete
    } else {
      // undo only retracts today's credit, not historical days you already earned
      const del = db
        .prepare("DELETE FROM completions WHERE kind = ? AND ref_id = ? AND day = ?")
        .run(kind, id, day);
      logged = -Number(del.changes); // 0 when there was no credit today to retract
    }
    bumpRev();
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  if (logged) {
    bumpActivity(day, kind, logged); // only after the commit — see bumpActivity
  }
  return getState();
}

// ── kata: honoring a daily form ─────────────────────────────────────────────────
/** One kata by id (camelCase, active as a real bool), or null. */
export function getKata(id) {
  const k = db
    .prepare(
      "SELECT id, title, note, builtin_id AS builtinId, active, position, created_at AS createdAt FROM kata WHERE id = ?",
    )
    .get(id);
  return k ? { ...k, active: !!k.active } : null;
}

/** Ids of the currently active kata, in display order. */
function activeKataIds() {
  return db
    .prepare("SELECT id FROM kata WHERE active = 1 ORDER BY position, created_at")
    .all()
    .map((r) => r.id);
}

/**
 * The kata block for the Today/dashboard payloads and the honor response:
 * the active kata with their honored-today flags, plus the day's summary.
 * `clean` is judged against the day's SNAPSHOT (kata_days.active_ids), not the
 * current active set — the set changing mid-day can't dirty an honored day.
 * @returns {{items: Array<{id,title,builtinId,active,honoredToday}>,
 *            today: {honored:number, total:number, clean:boolean}}}
 */
export function getKataToday(day = localDay(new Date().toISOString())) {
  const row = db.prepare("SELECT active_ids, honored_ids FROM kata_days WHERE day = ?").get(day);
  const honored = new Set(row ? JSON.parse(row.honored_ids) : []);
  const items = db
    .prepare(
      "SELECT id, title, builtin_id AS builtinId FROM kata WHERE active = 1 ORDER BY position, created_at",
    )
    .all()
    .map((k) => ({ ...k, active: true, honoredToday: honored.has(k.id) }));
  return {
    items,
    today: {
      honored: items.filter((i) => i.honoredToday).length,
      total: items.length,
      clean: isClean(
        row ? { activeIds: JSON.parse(row.active_ids), honoredIds: [...honored] } : null,
      ),
    },
  };
}

/**
 * Toggle today's honor on a kata. The FIRST honor of a day snapshots the current
 * active set into kata_days (the clean-day yardstick — later set edits don't move
 * it); every toggle updates honored_ids AND writes/removes a completions row
 * (kind "kata") so the heatmap + XP see the practice. Streak and daily goal
 * deliberately ignore kata rows — see momentum().
 * @param {string} id
 * @param {boolean} on
 * @param {string} [now] ISO timestamp (injectable for tests)
 * @param {string} [day] local YYYY-MM-DD override (defaults to localDay(now))
 * @returns {Object} the fresh state (sans history — see getState)
 */
export function setKataHonored(id, on, now = new Date().toISOString(), day = localDay(now)) {
  let logged = 0;
  db.exec("BEGIN");
  try {
    const k = db.prepare("SELECT id, active FROM kata WHERE id = ?").get(id);
    if (!k) {
      throw new Error(`kata not found: ${id}`);
    }
    if (!k.active) {
      throw new Error(`kata is not active: ${id}`); // a retired form isn't practiced
    }
    const row = db.prepare("SELECT active_ids, honored_ids FROM kata_days WHERE day = ?").get(day);
    const honored = new Set(row ? JSON.parse(row.honored_ids) : []);
    if (on) {
      honored.add(id);
    } else {
      honored.delete(id);
    }
    if (row && honored.size === 0) {
      // the day's last un-honor drops the ledger row entirely — the next first
      // honor re-snapshots a FRESH active set instead of resurrecting a stale
      // yardstick (which, after a retire, could make clean unreachable all day)
      db.prepare("DELETE FROM kata_days WHERE day = ?").run(day);
    } else if (row) {
      db.prepare("UPDATE kata_days SET honored_ids = ? WHERE day = ?").run(
        JSON.stringify([...honored]),
        day,
      );
    } else if (on) {
      // first honor of the day: snapshot the active set as the clean-day yardstick
      db.prepare("INSERT INTO kata_days(day, active_ids, honored_ids) VALUES(?, ?, ?)").run(
        day,
        JSON.stringify(activeKataIds()),
        JSON.stringify([...honored]),
      );
    }
    if (on) {
      const ins = db
        .prepare(
          "INSERT OR IGNORE INTO completions(id, day, kind, ref_id, ts) VALUES(?, ?, ?, ?, ?)",
        )
        .run(newId(), day, "kata", id, now);
      logged = Number(ins.changes); // 0 on a same-day re-honor
    } else {
      const del = db
        .prepare("DELETE FROM completions WHERE kind = 'kata' AND ref_id = ? AND day = ?")
        .run(id, day);
      logged = -Number(del.changes);
    }
    bumpRev();
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  if (logged) {
    bumpActivity(day, "kata", logged); // only after the commit — see bumpActivity
  }
  return getState();
}

/**
 * Intersect TODAY's kata_days snapshot with the still-active set after a
 * full-state replace: a mid-day retire/delete must not leave `clean` unreachable
 * (the Today banner's "{honored} of {total}" has to stay achievable). Only
 * today's row moves — history keeps the yardstick it was measured against. A
 * snapshot that empties drops the row, so the next honor re-snapshots fresh
 * instead of judging the day against []. Caller owns the transaction.
 */
function reconcileKataDay(day = localDay(new Date().toISOString())) {
  const row = db.prepare("SELECT active_ids FROM kata_days WHERE day = ?").get(day);
  if (!row) {
    return;
  }
  const active = new Set(activeKataIds());
  const snapshot = JSON.parse(row.active_ids);
  const kept = snapshot.filter((id) => active.has(id));
  if (kept.length === snapshot.length) {
    return; // nothing retired out of today's snapshot
  }
  if (kept.length === 0) {
    db.prepare("DELETE FROM kata_days WHERE day = ?").run(day);
  } else {
    db.prepare("UPDATE kata_days SET active_ids = ? WHERE day = ?").run(JSON.stringify(kept), day);
  }
}

// ── full state replace (PUT /api/state) ─────────────────────────────────────────
function replaceAll(state) {
  // children first (FKs), though ON DELETE CASCADE would handle it
  db.prepare("DELETE FROM tasks").run();
  db.prepare("DELETE FROM steps").run();
  db.prepare("DELETE FROM milestones").run();
  db.prepare("DELETE FROM roadmaps").run();
  db.prepare("DELETE FROM projects").run();
  db.prepare("DELETE FROM kata").run(); // kata_days stays — it's history, like completions
  db.prepare("DELETE FROM week_plans").run();
  db.prepare("DELETE FROM goals").run();

  const ins = {
    roadmap: db.prepare(
      "INSERT INTO roadmaps(id,title,source_url,color,archived,position,created_at,target_date,step_minutes) VALUES(@id,@title,@sourceUrl,@color,@archived,@position,@createdAt,@targetDate,@stepMinutes)",
    ),
    milestone: db.prepare(
      "INSERT INTO milestones(id,roadmap_id,title,position) VALUES(@id,@roadmapId,@title,@position)",
    ),
    step: db.prepare(
      "INSERT INTO steps(id,milestone_id,title,status,position,resource_url,notes,done_at,goal_id) VALUES(@id,@milestoneId,@title,@status,@position,@resourceUrl,@notes,@doneAt,@goalId)",
    ),
    project: db.prepare(
      "INSERT INTO projects(id,title,status,repo_url,summary,position,created_at,shipped_at,roadmap_id) VALUES(@id,@title,@status,@repoUrl,@summary,@position,@createdAt,@shippedAt,@roadmapId)",
    ),
    task: db.prepare(
      "INSERT INTO tasks(id,title,status,due,recurrence,step_id,project_id,est_min,position,notes,created_at,done_at,goal_id) VALUES(@id,@title,@status,@due,@recurrence,@stepId,@projectId,@estMin,@position,@notes,@createdAt,@doneAt,@goalId)",
    ),
    kata: db.prepare(
      "INSERT INTO kata(id,title,note,builtin_id,active,position,created_at) VALUES(@id,@title,@note,@builtinId,@active,@position,@createdAt)",
    ),
    goal: db.prepare(
      "INSERT INTO goals(id,title,area,note,color,status,position,created_at,achieved_at) VALUES(@id,@title,@area,@note,@color,@status,@position,@createdAt,@achievedAt)",
    ),
    weekPlan: db.prepare(
      "INSERT INTO week_plans(id,week_start,area,title,theme,roadmap_id,goal_id,targets,days,position,created_at) VALUES(@id,@weekStart,@area,@title,@theme,@roadmapId,@goalId,@targets,@days,@position,@createdAt)",
    ),
  };

  // pick-lists throughout (see pickTask): unknown extra keys must be stripped,
  // never handed to the SQL layer where they throw generic bind errors
  const nowIso = new Date().toISOString();
  // goal_id on tasks/steps is a soft, forgiving link (no FK) — a reference to a
  // goal absent from this state is nulled, exactly like project → roadmap below
  const goalIds = new Set((state.goals || []).map((g) => g.id));
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
      goalId: s.goalId != null && goalIds.has(s.goalId) ? s.goalId : null,
    });
  }
  // the SET-NULL that tasks' step FK promises but a full delete+reinsert never
  // delivers: a link to a roadmap absent from this state is nulled, not inserted
  // dangling (the column can't carry an FK — see the schema comment)
  const roadmapIds = new Set((state.roadmaps || []).map((r) => r.id));
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
      roadmapId: p.roadmapId != null && roadmapIds.has(p.roadmapId) ? p.roadmapId : null,
    });
  }
  for (const t of state.tasks || []) {
    const row = pickTask(t, nowIso);
    row.goalId = row.goalId != null && goalIds.has(row.goalId) ? row.goalId : null;
    ins.task.run(row);
  }
  for (const k of state.kata || []) {
    ins.kata.run({
      id: k.id,
      title: k.title,
      note: k.note ?? null,
      builtinId: k.builtinId ?? null,
      // absent → the schema default (active); coerce bool → 0/1 for the column
      active: k.active === false || k.active === 0 ? 0 : 1,
      position: k.position ?? 0,
      createdAt: k.createdAt ?? nowIso,
    });
  }
  for (const g of state.goals || []) {
    ins.goal.run({
      id: g.id,
      title: g.title,
      area: g.area ?? null,
      note: g.note ?? null,
      color: g.color ?? null,
      status: GOAL_STATUS.has(g.status) ? g.status : "active",
      position: g.position ?? 0,
      createdAt: g.createdAt ?? nowIso,
      achievedAt: g.achievedAt ?? null,
    });
  }
  for (const w of state.weekPlans || []) {
    ins.weekPlan.run({
      id: w.id,
      weekStart: w.weekStart,
      area: w.area,
      title: w.title ?? null,
      theme: w.theme ?? null,
      // soft links, nulled if their target isn't in this state (see goalIds above)
      roadmapId: w.roadmapId != null && roadmapIds.has(w.roadmapId) ? w.roadmapId : null,
      goalId: w.goalId != null && goalIds.has(w.goalId) ? w.goalId : null,
      targets: JSON.stringify(Array.isArray(w.targets) ? w.targets : []),
      days: JSON.stringify(w.days && typeof w.days === "object" ? w.days : {}),
      position: w.position ?? 0,
      createdAt: w.createdAt ?? nowIso,
    });
  }

  if (state.profile) {
    setMeta("profile", state.profile);
  }
  if (state.settings) {
    setMeta("settings", state.settings);
  }
}

// ── trash: the undo net for deletes-by-absence ──────────────────────────────────
// Deletes in michi happen by ABSENCE: the client PUTs the whole state and
// replaceAll wipes + reinserts, so nothing ever announces "delete this". Before
// each replace, putState diffs old vs new and snapshots whatever disappeared:
//  - a roadmap takes its whole subtree (milestones + steps) along in ONE row
//  - a step vanishing while its roadmap SURVIVES gets a row of its own — the
//    client has a per-step delete button, so those are real deletes too (steps
//    already leaving inside a roadmap row are never double-trashed)
//  - a project, task, or kata gets a row of its own
//  - milestones alone are never snapshotted: they're bare headings, and their
//    steps get step rows anyway — a milestone row would just be noise
// Each snapshot also records the OLD state's inbound links (which projects/tasks
// pointed at the vanished rows), so a restore can stitch them back — see
// restoreTrash. importAll deliberately does NOT trash: import (JSON restore,
// Claude sync apply) is a replace semantic — the user consciously swaps the
// dataset, and trashing the entire old model on every sync would flush real
// deletes out of retention.

/** Purge trash past its retention: drop rows older than TRASH_RETENTION_DAYS,
 * then keep only the newest TRASH_MAX_ROWS (rowid breaks same-timestamp ties in
 * insertion order). Runs at boot and after every insert. */
function enforceTrashRetention(now = new Date().toISOString()) {
  const cutoff = new Date(Date.parse(now) - TRASH_RETENTION_DAYS * 86400000).toISOString();
  db.prepare("DELETE FROM trash WHERE deleted_at < ?").run(cutoff);
  db.prepare(
    "DELETE FROM trash WHERE rowid NOT IN (SELECT rowid FROM trash ORDER BY deleted_at DESC, rowid DESC LIMIT ?)",
  ).run(TRASH_MAX_ROWS);
}
enforceTrashRetention(); // boot: a long-lived server still ages its trash out

/** Diff the live tables against an incoming full state and snapshot everything
 * that disappeared into trash. Caller owns the transaction — run BEFORE the
 * replace, while the old rows are still there to read.
 * @returns {Array<{id, kind, title}>} the inserted rows, in insertion order —
 *   putState ships this receipt so the client can offer undo without guessing */
function trashDeleted(next, now = new Date().toISOString()) {
  const ins = db.prepare(
    "INSERT INTO trash(id, kind, title, payload, deleted_at) VALUES(?, ?, ?, ?, ?)",
  );
  const trashed = [];
  const put = (kind, title, payload) => {
    const id = uid("tr");
    ins.run(id, kind, title, JSON.stringify(payload), now);
    trashed.push({ id, kind, title });
  };
  const keep = {
    roadmaps: new Set((next.roadmaps || []).map((r) => r.id)),
    steps: new Set((next.steps || []).map((s) => s.id)),
    projects: new Set((next.projects || []).map((p) => p.id)),
    tasks: new Set((next.tasks || []).map((t) => t.id)),
    kata: new Set((next.kata || []).map((k) => k.id)),
    goals: new Set((next.goals || []).map((g) => g.id)),
    weekPlans: new Set((next.weekPlans || []).map((w) => w.id)),
  };
  const old = getState();
  const inRoadmapRow = new Set(); // step ids already leaving inside a subtree row
  for (const r of old.roadmaps) {
    if (keep.roadmaps.has(r.id)) {
      continue;
    }
    const milestones = old.milestones.filter((m) => m.roadmapId === r.id);
    const msIds = new Set(milestones.map((m) => m.id));
    const steps = old.steps.filter((s) => msIds.has(s.milestoneId));
    const stepIds = new Set(steps.map((s) => s.id));
    for (const id of stepIds) {
      inRoadmapRow.add(id);
    }
    // inbound links, read from the OLD state before the client's unlinking lands
    put("roadmap", r.title, {
      roadmap: r,
      milestones,
      steps,
      links: {
        projects: old.projects.filter((p) => p.roadmapId === r.id).map((p) => p.id),
        tasks: old.tasks
          .filter((t) => t.stepId != null && stepIds.has(t.stepId))
          .map((t) => ({ id: t.id, stepId: t.stepId })),
      },
    });
  }
  // a step that vanished on its own — the per-step delete button, or its
  // milestone edited away while the roadmap stays — is a real delete too
  for (const s of old.steps) {
    if (keep.steps.has(s.id) || inRoadmapRow.has(s.id)) {
      continue;
    }
    put("step", s.title, {
      step: s,
      links: { tasks: old.tasks.filter((t) => t.stepId === s.id).map((t) => t.id) },
    });
  }
  for (const p of old.projects) {
    if (!keep.projects.has(p.id)) {
      put("project", p.title, {
        project: p,
        links: { tasks: old.tasks.filter((t) => t.projectId === p.id).map((t) => t.id) },
      });
    }
  }
  for (const t of old.tasks) {
    if (!keep.tasks.has(t.id)) {
      put("task", t.title, { task: t });
    }
  }
  for (const k of old.kata) {
    if (!keep.kata.has(k.id)) {
      put("kata", k.title, { kata: k }); // its honor history (kata_days) stays put
    }
  }
  // a goal takes the inbound attributions along (which tasks/steps pointed at it),
  // read from the OLD state before replaceAll nulls them, so a restore can re-stitch
  for (const g of old.goals) {
    if (!keep.goals.has(g.id)) {
      put("goal", g.title, {
        goal: g,
        links: {
          tasks: old.tasks.filter((t) => t.goalId === g.id).map((t) => t.id),
          steps: old.steps.filter((s) => s.goalId === g.id).map((s) => s.id),
        },
      });
    }
  }
  for (const w of old.weekPlans) {
    if (!keep.weekPlans.has(w.id)) {
      put("weekPlan", w.title || w.area || "week plan", { weekPlan: w });
    }
  }
  if (trashed.length > 0) {
    enforceTrashRetention(now);
  }
  return trashed;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Human summary of what a trash payload contains ("2 milestones · 5 steps");
 * null for kinds with nothing to count (a lone step, project, or task). */
function trashCounts(kind, payload) {
  if (kind !== "roadmap") {
    return null;
  }
  const ms = (payload.milestones || []).length;
  const steps = (payload.steps || []).length;
  return `${plural(ms, "milestone")} · ${plural(steps, "step")}`;
}

/** The trash listing (newest first): id, kind, title, deletedAt + a counts line. */
export function listTrash() {
  return db
    .prepare(
      "SELECT id, kind, title, payload, deleted_at AS deletedAt FROM trash ORDER BY deleted_at DESC, rowid DESC",
    )
    .all()
    .map(({ payload, ...row }) => ({ ...row, counts: trashCounts(row.kind, JSON.parse(payload)) }));
}

/**
 * Restore one trash row: re-insert its snapshot, drop the row, bump the rev — all
 * in one transaction. If ANY snapshot id meanwhile exists again (the user
 * recreated the item), EVERY id in the snapshot is remapped to a fresh uid so a
 * restore can never collide; outward refs (task.stepId/projectId,
 * project.roadmapId) that no longer resolve are nulled rather than left dangling.
 * Inbound links recorded at trash time are stitched back — but only onto linking
 * items that still exist and haven't been repointed meanwhile (their link column
 * is still null), and always through the remap so they follow fresh ids.
 * @returns {{state: Object, restored: {id, kind, title, remapped: boolean}}}
 * @throws {Error} when the trash entry doesn't exist
 * @throws {ConflictError} for a step row whose parent milestone is gone — the
 *   step has nowhere to hang; the roadmap row (which carries the milestone) is
 *   the restore path then
 */
export function restoreTrash(id) {
  const row = db.prepare("SELECT id, kind, title, payload FROM trash WHERE id = ?").get(id);
  if (!row) {
    throw new Error(`trash entry not found: ${id}`);
  }
  const snap = JSON.parse(row.payload);
  const roadmap = snap.roadmap ?? null;
  const milestones = snap.milestones || [];
  const steps = snap.steps || [];
  const step = snap.step ?? null; // a lone step row (kind "step")
  const project = snap.project ?? null;
  const task = snap.task ?? null;
  const kata = snap.kata ?? null;
  const goal = snap.goal ?? null;
  const weekPlan = snap.weekPlan ?? null;
  const links = snap.links || {};

  const exists = (table, xid) =>
    xid != null && !!db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(xid);

  // a lone step's milestone is an outward ref it can't live without (the FK) —
  // refuse up front with a message that points at the working path
  if (step && !exists("milestones", step.milestoneId)) {
    throw new ConflictError(
      `can't restore "${row.title}" — its milestone is gone; restore the whole roadmap from the trash instead`,
    );
  }

  // every id the snapshot OWNS, with its table — one list drives both the
  // collision scan and the remap, so they can never disagree
  const owned = [
    ...(roadmap ? [["roadmaps", "rm", roadmap]] : []),
    ...milestones.map((m) => ["milestones", "ms", m]),
    ...steps.map((s) => ["steps", "step", s]),
    ...(step ? [["steps", "step", step]] : []),
    ...(project ? [["projects", "proj", project]] : []),
    ...(task ? [["tasks", "task", task]] : []),
    ...(kata ? [["kata", "kata", kata]] : []),
    ...(goal ? [["goals", "goal", goal]] : []),
    ...(weekPlan ? [["week_plans", "wk", weekPlan]] : []),
  ];
  const remapped = owned.some(([table, , item]) => exists(table, item.id));
  const idMap = new Map();
  if (remapped) {
    for (const [, prefix, item] of owned) {
      idMap.set(item.id, uid(prefix));
    }
  }
  const mapId = (xid) => (idMap.has(xid) ? idMap.get(xid) : xid);

  const nowIso = new Date().toISOString();
  db.exec("BEGIN");
  try {
    if (roadmap) {
      db.prepare(
        "INSERT INTO roadmaps(id,title,source_url,color,archived,position,created_at,target_date,step_minutes) VALUES(?,?,?,?,?,?,?,?,?)",
      ).run(
        mapId(roadmap.id),
        roadmap.title,
        roadmap.sourceUrl ?? null,
        roadmap.color ?? null,
        roadmap.archived ? 1 : 0,
        roadmap.position ?? 0,
        roadmap.createdAt ?? nowIso,
        roadmap.targetDate ?? null,
        roadmap.stepMinutes ?? null,
      );
      for (const m of milestones) {
        db.prepare("INSERT INTO milestones(id,roadmap_id,title,position) VALUES(?,?,?,?)").run(
          mapId(m.id),
          mapId(m.roadmapId),
          m.title,
          m.position ?? 0,
        );
      }
      for (const s of steps) {
        db.prepare(
          "INSERT INTO steps(id,milestone_id,title,status,position,resource_url,notes,done_at,goal_id) VALUES(?,?,?,?,?,?,?,?,?)",
        ).run(
          mapId(s.id),
          mapId(s.milestoneId),
          s.title,
          s.status ?? "todo",
          s.position ?? 0,
          s.resourceUrl ?? null,
          s.notes ?? null,
          s.doneAt ?? null,
          // attribution is an outward soft link — the goal may be gone by now
          exists("goals", s.goalId) ? s.goalId : null,
        );
      }
    }
    if (step) {
      db.prepare(
        "INSERT INTO steps(id,milestone_id,title,status,position,resource_url,notes,done_at,goal_id) VALUES(?,?,?,?,?,?,?,?,?)",
      ).run(
        mapId(step.id),
        step.milestoneId, // outward ref — its existence was checked up front
        step.title,
        step.status ?? "todo",
        step.position ?? 0,
        step.resourceUrl ?? null,
        step.notes ?? null,
        step.doneAt ?? null,
        exists("goals", step.goalId) ? step.goalId : null,
      );
    }
    if (project) {
      db.prepare(
        "INSERT INTO projects(id,title,status,repo_url,summary,position,created_at,shipped_at,roadmap_id) VALUES(?,?,?,?,?,?,?,?,?)",
      ).run(
        mapId(project.id),
        project.title,
        project.status ?? "idea",
        project.repoUrl ?? null,
        project.summary ?? null,
        project.position ?? 0,
        project.createdAt ?? nowIso,
        project.shippedAt ?? null,
        // outward ref — the linked roadmap may be gone by now
        exists("roadmaps", project.roadmapId) ? project.roadmapId : null,
      );
    }
    if (task) {
      db.prepare(
        `INSERT INTO tasks(id,title,status,due,recurrence,step_id,project_id,est_min,position,notes,created_at,done_at,goal_id)
         VALUES(@id,@title,@status,@due,@recurrence,@stepId,@projectId,@estMin,@position,@notes,@createdAt,@doneAt,@goalId)`,
      ).run(
        pickTask(
          {
            ...task,
            id: mapId(task.id),
            // outward refs — the linked step/project/goal may be gone by now
            stepId: exists("steps", task.stepId) ? task.stepId : null,
            projectId: exists("projects", task.projectId) ? task.projectId : null,
            goalId: exists("goals", task.goalId) ? task.goalId : null,
          },
          nowIso,
        ),
      );
    }
    if (kata) {
      // no active-count cap anymore — a restored kata simply comes back in the
      // state it was trashed in
      const wantsActive = kata.active !== false && kata.active !== 0;
      db.prepare(
        "INSERT INTO kata(id,title,note,builtin_id,active,position,created_at) VALUES(?,?,?,?,?,?,?)",
      ).run(
        mapId(kata.id),
        kata.title,
        kata.note ?? null,
        kata.builtinId ?? null,
        wantsActive ? 1 : 0,
        kata.position ?? 0,
        kata.createdAt ?? nowIso,
      );
    }
    if (goal) {
      db.prepare(
        "INSERT INTO goals(id,title,area,note,color,status,position,created_at,achieved_at) VALUES(?,?,?,?,?,?,?,?,?)",
      ).run(
        mapId(goal.id),
        goal.title,
        goal.area ?? null,
        goal.note ?? null,
        goal.color ?? null,
        GOAL_STATUS.has(goal.status) ? goal.status : "active",
        goal.position ?? 0,
        goal.createdAt ?? nowIso,
        goal.achievedAt ?? null,
      );
    }
    if (weekPlan) {
      db.prepare(
        "INSERT INTO week_plans(id,week_start,area,title,theme,roadmap_id,goal_id,targets,days,position,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      ).run(
        mapId(weekPlan.id),
        weekPlan.weekStart,
        weekPlan.area,
        weekPlan.title ?? null,
        weekPlan.theme ?? null,
        // outward soft links — the roadmap/goal may be gone by now
        exists("roadmaps", weekPlan.roadmapId) ? weekPlan.roadmapId : null,
        exists("goals", weekPlan.goalId) ? weekPlan.goalId : null,
        JSON.stringify(Array.isArray(weekPlan.targets) ? weekPlan.targets : []),
        JSON.stringify(weekPlan.days && typeof weekPlan.days === "object" ? weekPlan.days : {}),
        weekPlan.position ?? 0,
        weekPlan.createdAt ?? nowIso,
      );
    }
    // stitch severed inbound links back (recorded at trash time from the OLD
    // state). The WHERE clauses carry the whole policy: the linking item must
    // still exist (0 changes otherwise) and must not have been repointed
    // meanwhile (its link column is still NULL) — and mapId keeps every
    // re-attachment on the fresh ids when the restore had to remap.
    if (roadmap) {
      for (const pid of links.projects || []) {
        db.prepare("UPDATE projects SET roadmap_id = ? WHERE id = ? AND roadmap_id IS NULL").run(
          mapId(roadmap.id),
          pid,
        );
      }
      for (const l of links.tasks || []) {
        db.prepare("UPDATE tasks SET step_id = ? WHERE id = ? AND step_id IS NULL").run(
          mapId(l.stepId),
          l.id,
        );
      }
    }
    if (step) {
      for (const tid of links.tasks || []) {
        db.prepare("UPDATE tasks SET step_id = ? WHERE id = ? AND step_id IS NULL").run(
          mapId(step.id),
          tid,
        );
      }
    }
    if (project) {
      for (const tid of links.tasks || []) {
        db.prepare("UPDATE tasks SET project_id = ? WHERE id = ? AND project_id IS NULL").run(
          mapId(project.id),
          tid,
        );
      }
    }
    if (goal) {
      for (const tid of links.tasks || []) {
        db.prepare("UPDATE tasks SET goal_id = ? WHERE id = ? AND goal_id IS NULL").run(
          mapId(goal.id),
          tid,
        );
      }
      for (const sid of links.steps || []) {
        db.prepare("UPDATE steps SET goal_id = ? WHERE id = ? AND goal_id IS NULL").run(
          mapId(goal.id),
          sid,
        );
      }
    }
    db.prepare("DELETE FROM trash WHERE id = ?").run(id);
    bumpRev();
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return {
    state: getState(),
    restored: { id: row.id, kind: row.kind, title: row.title, remapped },
  };
}

/** Purge one trash row for good. @returns {boolean} whether a row was removed */
export function purgeTrash(id) {
  return Number(db.prepare("DELETE FROM trash WHERE id = ?").run(id).changes) > 0;
}

/** Empty the trash for good. @returns {number} rows removed */
export function purgeAllTrash() {
  return Number(db.prepare("DELETE FROM trash").run().changes);
}

// node:sqlite has no .transaction() helper — wrap manually so a bad PUT can't
// leave the tables half-written. `expectedRev` enables optimistic concurrency.
export class ConflictError extends Error {}

/**
 * Replace the full state inside a transaction, bumping the rev. The completions
 * log is deliberately untouched (see replaceCompletions): a `completions` key in
 * the incoming body is simply ignored. Whatever the incoming state DROPPED is
 * snapshotted into trash first (same transaction — see trashDeleted), and the
 * response carries that receipt as `trashed: [{id, kind, title}]` (an empty
 * array when nothing vanished) so the client's undo toast binds to the exact
 * rows this write created — never a guess at the newest trash entry. Only this
 * everyday PUT sets `trashed`: import/sync land in importAll, which never
 * trashes, so their responses carry no such key.
 * @param {number} [expectedRev] - if set and stale, throws ConflictError
 * @returns {Object} the fresh state (sans completions log — see getState) plus
 *   the `trashed` receipt
 */
export function putState(state, expectedRev) {
  if (expectedRev != null && Number(expectedRev) !== getRev()) {
    throw new ConflictError("state changed since you loaded it");
  }
  let trashed;
  db.exec("BEGIN");
  try {
    trashed = trashDeleted(state); // before the replace, while the old rows still exist
    replaceAll(state);
    reconcileKataDay(); // today's honor snapshot follows a retire/delete — see above
    bumpRev();
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return { ...getState(), trashed };
}

/**
 * Erase everything — all rows + the saved profile/settings — and start fresh.
 * The trash goes too: "erase everything" means no residue, and reset is an
 * explicit, confirmed act — not the accident the trash exists to catch.
 * @returns {Object} the fresh (empty) state (sans completions log — see getState)
 */
export function resetAll() {
  db.exec("BEGIN");
  try {
    for (const t of [
      "tasks",
      "steps",
      "milestones",
      "roadmaps",
      "projects",
      "kata",
      "goals",
      "week_plans",
      "kata_days",
      "completions",
      "journal",
      "trash",
    ]) {
      db.prepare(`DELETE FROM ${t}`).run();
    }
    db.prepare("DELETE FROM meta WHERE key IN ('profile', 'settings', 'planSkips')").run();
    bumpRev();
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  dropActivityCache(); // the log is gone — the summary must forget it too
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

/** Inner worker for kata-honor-ledger rebuilds — the caller owns the transaction.
 * Rows come pre-validated (validateState checks day + arrays on import), but skip
 * malformed ones defensively rather than fail the whole import. */
function writeKataDayRows(rows = []) {
  db.prepare("DELETE FROM kata_days").run();
  const ins = db.prepare(
    "INSERT OR IGNORE INTO kata_days(day, active_ids, honored_ids) VALUES(?, ?, ?)",
  );
  for (const r of rows) {
    if (!r || !isValidDay(r.day) || !Array.isArray(r.activeIds) || !Array.isArray(r.honoredIds)) {
      continue;
    }
    ins.run(r.day, JSON.stringify(r.activeIds), JSON.stringify(r.honoredIds));
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
  dropActivityCache(); // wholesale rewrite — rebuild the summary on next read
  return getFullState();
}

/**
 * Backup import: replace the whole model AND the completion log in ONE
 * transaction. Running them as two separate transactions meant a failure in the
 * second half-applied the import (new tables, old history) while reporting an
 * error — the rollback here covers both. NO trash snapshots here, on purpose:
 * import is a restore/replace semantic (the user consciously swaps the whole
 * dataset — and Claude sync applies land here too), not an edit that can lose
 * work by accident — see the trash section.
 * @returns {Object} the fresh full state incl. the imported completions log
 */
export function importAll(state) {
  db.exec("BEGIN");
  try {
    replaceAll(state);
    writeCompletionRows(state.completions || []);
    writeKataDayRows(state.kataDays || []); // honor history restores with the backup
    writeJournalRows(state.journal || []); // the time log restores with the backup too
    bumpRev();
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  dropActivityCache(); // wholesale rewrite — rebuild the summary on next read
  return getFullState();
}

// Hand the engine our cached aggregate: every momentum() call in this process now
// reads day-counts from memory instead of re-walking the raw completions log.
setActivitySource(getActivitySummary);

export { DEFAULT_PROFILE, DEFAULT_SETTINGS };
