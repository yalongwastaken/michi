import { test } from "node:test";
import assert from "node:assert/strict";
import { dueLabel, minutes, shortDate, addDays, timeAgo } from "../src/lib/format.js";

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

test("addDays: shifts a day key, crossing month and year edges", () => {
  assert.equal(addDays("2026-06-23", 0), "2026-06-23");
  assert.equal(addDays("2026-06-23", 1), "2026-06-24");
  assert.equal(addDays("2026-06-30", 7), "2026-07-07");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
});

test("timeAgo: compact relative labels", () => {
  const now = Date.parse("2026-07-13T12:00:00Z");
  assert.equal(timeAgo("2026-07-13T11:59:40Z", now), "just now");
  assert.equal(timeAgo("2026-07-13T11:15:00Z", now), "45m ago");
  assert.equal(timeAgo("2026-07-13T07:00:00Z", now), "5h ago");
  assert.equal(timeAgo("2026-07-10T12:00:00Z", now), "3d ago");
  assert.equal(timeAgo("not a date", now), "");
});

test("shortDate: includes day + month (order is locale-dependent)", () => {
  const out = shortDate("2026-06-23");
  assert.match(out, /23/);
  assert.match(out, /Jun/);
});
