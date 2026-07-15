// journal.test.js — the time-log table: CRUD, range/order, validation, and the
// export/import round-trip (so backups keep the journal). Throwaway DB via MICHI_DB.
process.env.TZ = "UTC";
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";

const DB = join(tmpdir(), `michi-journal-test-${process.pid}.db`);
process.env.MICHI_DB = DB;
const db = await import("./db.js");

test.after(() => {
  for (const ext of ["", "-wal", "-shm"]) {
    try {
      rmSync(DB + ext);
    } catch {
      /* ignore */
    }
  }
});

test("add / range / update / delete", () => {
  db.resetAll();
  const a = db.addJournalEntry({
    day: "2026-07-14",
    title: "studied SPI",
    startMin: 540,
    endMin: 660,
  });
  assert.match(a.id, /^jr_/);
  assert.equal(a.startMin, 540);
  db.addJournalEntry({ day: "2026-07-14", title: "read datasheet" }); // untimed
  db.addJournalEntry({ day: "2026-07-10", title: "out of range" });

  const range = db.getJournalRange("2026-07-12", "2026-07-15");
  assert.equal(range.length, 2);
  // timed entries sort before untimed (the timeline order)
  assert.equal(range[0].title, "studied SPI");
  assert.equal(range[1].startMin, null);

  const up = db.updateJournalEntry(a.id, { title: "SPI driver", endMin: 720 });
  assert.equal(up.title, "SPI driver");
  assert.equal(up.endMin, 720);

  assert.equal(db.deleteJournalEntry(a.id), true);
  assert.equal(db.deleteJournalEntry(a.id), false); // already gone
  assert.equal(db.getJournalRange("2026-07-12", "2026-07-15").length, 1);
});

test("validateState covers journal rows", () => {
  assert.equal(
    db.validateState({ journal: [{ day: "2026-07-14", title: "ok", startMin: 60 }] }),
    null,
  );
  assert.ok(db.validateState({ journal: [{ day: "nope", title: "x" }] }));
  assert.ok(db.validateState({ journal: [{ day: "2026-07-14", title: "" }] }));
  assert.ok(db.validateState({ journal: [{ day: "2026-07-14", title: "x", startMin: 9000 }] }));
  assert.ok(
    db.validateState({ journal: [{ day: "2026-07-14", title: "x", startMin: 600, endMin: 300 }] }),
  );
});

test("journal round-trips through export → import", () => {
  db.resetAll();
  db.addJournalEntry({ day: "2026-07-14", title: "blinky", startMin: 840, endMin: 900 });
  const full = db.getFullState();
  assert.equal(full.journal.length, 1);

  db.resetAll();
  assert.equal(db.getFullState().journal.length, 0);
  db.importAll(full);
  const back = db.getFullState().journal;
  assert.equal(back.length, 1);
  assert.equal(back[0].title, "blinky");
  assert.equal(back[0].startMin, 840);
});
