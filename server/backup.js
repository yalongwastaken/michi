// backup.js — WAL-safe snapshot of the Michi database.
// A plain `cp michi.db` is wrong under WAL mode: everything since the last
// checkpoint lives in michi.db-wal, so the copy silently misses recent writes and
// can even tear mid-transaction. VACUUM INTO asks SQLite itself to write a complete,
// consistent, compacted copy — safe while the server is running. No dependencies;
// run with the same flag as the server:
//
//   node --experimental-sqlite server/backup.js backups/michi-2026-07-01.db
//
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
// same resolution as db.js — MICHI_DB wins, else the default file next to the server
const DB_PATH = process.env.MICHI_DB || join(__dirname, "data", "michi.db");

const dest = process.argv[2];
if (!dest) {
  console.error("usage: node --experimental-sqlite backup.js <destination.db>");
  process.exit(1);
}
if (!existsSync(DB_PATH)) {
  console.error(`backup: no database at ${DB_PATH} — nothing to back up`);
  process.exit(1);
}

mkdirSync(dirname(dest), { recursive: true });
// VACUUM INTO refuses to overwrite an existing file — a same-day re-run should
// replace today's snapshot, so delete it first
if (existsSync(dest)) {
  unlinkSync(dest);
}

const db = new DatabaseSync(DB_PATH);
try {
  db.prepare("VACUUM INTO ?").run(dest);
} finally {
  db.close();
}
console.log(`backup: ${DB_PATH} → ${dest}`);
