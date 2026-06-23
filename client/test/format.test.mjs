import { test } from "node:test";
import assert from "node:assert/strict";
import { dueLabel, minutes, shortDate } from "../src/lib/format.js";

test("dueLabel: relative wording", () => {
  assert.equal(dueLabel("2026-06-23", "2026-06-23"), "today");
  assert.equal(dueLabel("2026-06-24", "2026-06-23"), "tomorrow");
  assert.equal(dueLabel("2026-06-22", "2026-06-23"), "yesterday");
  assert.equal(dueLabel("2026-06-20", "2026-06-23"), "3d overdue");
  assert.equal(dueLabel("2026-06-28", "2026-06-23"), "in 5d");
  assert.equal(dueLabel(null), null);
});

test("minutes: human label", () => {
  assert.equal(minutes(45), "45m");
  assert.equal(minutes(60), "1h");
  assert.equal(minutes(90), "1h 30m");
  assert.equal(minutes(0), null);
  assert.equal(minutes(null), null);
});

test("shortDate: includes day + month (order is locale-dependent)", () => {
  const out = shortDate("2026-06-23");
  assert.match(out, /23/);
  assert.match(out, /Jun/);
});
