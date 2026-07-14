// backup.js — WAL-safe snapshot of the Michi database.
// A plain `cp michi.db` is wrong under WAL mode: everything since the last
// checkpoint lives in michi.db-wal, so the copy silently misses recent writes and
// can even tear mid-transaction. VACUUM INTO asks SQLite itself to write a complete,
// consistent, compacted copy — safe while the server is running.
//
// Two callers share this file: the standalone CLI the nightly systemd timer /
// `make backup` runs (explicit destination, rotation handled by the Makefile), and
// the server's "Back up now" endpoint, which uses runBackup() — same snapshot, same
// folder, same keep-the-newest-14 rotation, just in-process. No dependencies; the
// CLI runs with the same flag as the server:
//
//   node --experimental-sqlite server/backup.js backups/michi-2026-07-01.db
//
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";
import { existsSync, mkdirSync, unlinkSync, readdirSync, statSync } from "node:fs";
import { dayKey } from "./dates.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** How many snapshots rotation keeps — mirrors the `tail -n +15` in the Makefile. */
export const KEEP = 14;

// same resolution as db.js — MICHI_DB wins, else the default file next to the server.
// Read per-call (not at module load) so tests can point at a throwaway database.
function dbPath() {
  return process.env.MICHI_DB || join(__dirname, "data", "michi.db");
}

/** The backups folder: MICHI_BACKUPS, else ./backups at the repo root — the same
 * place `make backup` (run from the root, see michi-backup.service) writes to. */
export function backupDir() {
  return process.env.MICHI_BACKUPS || join(__dirname, "..", "backups");
}

// one snapshot's directory entry, the shape the API serves
function entryFor(path) {
  const st = statSync(path);
  return { file: basename(path), sizeBytes: st.size, mtime: st.mtime.toISOString() };
}

/** List the snapshots in `dir`, newest first. A missing/empty folder is just [].
 * Only real files count: a directory that happens to match michi-*.db must not
 * be listed (rotation would try to unlink it and die with EISDIR — rotateBackups
 * deletes whatever this returns). */
export function listBackups(dir = backupDir()) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return []; // no folder yet — no backup has ever run
  }
  return names
    .filter((n) => /^michi-.*\.db$/.test(n))
    .filter((n) => statSync(join(dir, n)).isFile())
    .map((n) => entryFor(join(dir, n)))
    .sort((a, b) => (a.mtime < b.mtime ? 1 : a.mtime > b.mtime ? -1 : 0));
}

/** VACUUM INTO `dest` (creating its folder; replacing a same-day file). Throws if
 * there's no database yet. Returns the new file's directory entry. */
export function snapshotTo(dest, { db = dbPath() } = {}) {
  if (!existsSync(db)) {
    throw new Error(`no database at ${db} — nothing to back up`);
  }
  mkdirSync(dirname(dest), { recursive: true });
  // VACUUM INTO refuses to overwrite an existing file — a same-day re-run should
  // replace today's snapshot, so delete it first
  if (existsSync(dest)) {
    unlinkSync(dest);
  }
  const conn = new DatabaseSync(db);
  try {
    conn.prepare("VACUUM INTO ?").run(dest);
  } finally {
    conn.close();
  }
  return entryFor(dest);
}

/** Delete all but the newest `keep` snapshots in `dir` (mirrors the Makefile).
 * listBackups already filters to plain files, so a decoy directory can't reach
 * the unlink here. */
export function rotateBackups(dir = backupDir(), keep = KEEP) {
  for (const b of listBackups(dir).slice(keep)) {
    unlinkSync(join(dir, b.file));
  }
}

/**
 * The full nightly routine, in-process: snapshot today's database into the backups
 * folder (michi-YYYY-MM-DD.db, server-local day) and rotate to the newest 14.
 * Returns the new file's entry — what POST /api/backup serves.
 */
export function runBackup({ dir = backupDir(), day = dayKey() } = {}) {
  const entry = snapshotTo(join(dir, `michi-${day}.db`));
  rotateBackups(dir);
  return entry;
}

// ── CLI (the systemd timer / `make backup` path) ─────────────────────────────
// Only when run directly — importing this module must never touch argv or exit.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dest = process.argv[2];
  if (!dest) {
    console.error("usage: node --experimental-sqlite backup.js <destination.db>");
    process.exit(1);
  }
  try {
    snapshotTo(dest);
  } catch (e) {
    console.error(`backup: ${e.message}`);
    process.exit(1);
  }
  console.log(`backup: ${dbPath()} → ${dest}`);
}
