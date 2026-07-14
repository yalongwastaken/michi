// backup.test.js — the snapshot core (backup.js) against a throwaway database:
// VACUUM INTO produces a real, openable copy; listing sorts newest first; rotation
// keeps exactly the newest 14. The HTTP layer over this lives in http.test.js.
process.env.TZ = "UTC";
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { snapshotTo, listBackups, rotateBackups, runBackup, KEEP } from "./backup.js";

// a tiny real database + an empty backups folder, both throwaway
const dir = mkdtempSync(join(tmpdir(), "michi-backup-test-"));
const db = join(dir, "michi.db");
const backups = join(dir, "backups");
process.env.MICHI_DB = db;
{
  const conn = new DatabaseSync(db);
  conn.exec("CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('hello')");
  conn.close();
}

test.after(() => rmSync(dir, { recursive: true, force: true }));

test("snapshotTo writes a complete, openable copy (and replaces a same-day file)", () => {
  const dest = join(backups, "michi-2026-07-13.db");
  const entry = snapshotTo(dest);
  assert.equal(entry.file, "michi-2026-07-13.db");
  assert.ok(entry.sizeBytes > 0);
  const again = snapshotTo(dest); // re-run must replace, not throw
  assert.equal(again.file, entry.file);
  const conn = new DatabaseSync(dest);
  try {
    assert.equal(conn.prepare("SELECT v FROM t").get().v, "hello");
  } finally {
    conn.close();
  }
});

test("snapshotTo without a database refuses cleanly", () => {
  assert.throws(
    () => snapshotTo(join(backups, "x.db"), { db: join(dir, "nope.db") }),
    /nothing to back up/,
  );
});

test("listBackups: missing folder → [], otherwise michi-*.db newest first", () => {
  assert.deepEqual(listBackups(join(dir, "not-there")), []);
  writeFileSync(join(backups, "notes.txt"), "not a snapshot"); // ignored
  snapshotTo(join(backups, "michi-2026-07-12.db"));
  utimesSync(join(backups, "michi-2026-07-12.db"), new Date("2026-07-12"), new Date("2026-07-12"));
  const items = listBackups(backups);
  assert.deepEqual(
    items.map((b) => b.file),
    ["michi-2026-07-13.db", "michi-2026-07-12.db"],
  );
});

test("a decoy directory named like a snapshot is ignored by list AND rotation", () => {
  const decoys = join(dir, "decoys");
  snapshotTo(join(decoys, "michi-2026-07-10.db"));
  mkdirSync(join(decoys, "michi-decoy.db")); // a directory, not a snapshot
  const items = listBackups(decoys);
  assert.deepEqual(
    items.map((b) => b.file),
    ["michi-2026-07-10.db"],
  );
  // rotation deletes everything past keep=0 — it must skip the directory
  // instead of dying with EISDIR on unlink
  rotateBackups(decoys, 0);
  assert.deepEqual(listBackups(decoys), []);
});

test("rotateBackups keeps exactly the newest 14; runBackup does the whole routine", () => {
  const lot = join(dir, "lot");
  for (let i = 1; i <= 20; i++) {
    const day = `2026-06-${String(i).padStart(2, "0")}`;
    const f = join(lot, `michi-${day}.db`);
    snapshotTo(f);
    utimesSync(f, new Date(day), new Date(day)); // spread mtimes so "newest" is real
  }
  rotateBackups(lot);
  const kept = listBackups(lot);
  assert.equal(kept.length, KEEP);
  assert.equal(kept[0].file, "michi-2026-06-20.db"); // newest survived
  assert.equal(kept[KEEP - 1].file, "michi-2026-06-07.db"); // oldest kept

  const entry = runBackup({ dir: lot, day: "2026-06-30" }); // snapshot + rotate
  assert.equal(entry.file, "michi-2026-06-30.db");
  const after = listBackups(lot);
  assert.equal(after.length, KEEP); // still capped
  assert.equal(after[0].file, "michi-2026-06-30.db");
});
