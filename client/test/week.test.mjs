import { test } from "node:test";
import assert from "node:assert/strict";
import { weekStartOf, weekdayKeyOf, weekDays, weekLabel } from "../src/lib/week.js";
import { shortDate } from "../src/lib/format.js";

test("weekStartOf: snaps to the containing Monday", () => {
  assert.equal(weekStartOf("2026-07-22"), "2026-07-20"); // Wed → Mon
  assert.equal(weekStartOf("2026-07-20"), "2026-07-20"); // Mon → itself
  assert.equal(weekStartOf("2026-07-26"), "2026-07-20"); // Sun → the Mon before
  assert.equal(weekStartOf("2026-07-27"), "2026-07-27"); // next Mon
});

test("weekdayKeyOf: Mon-first weekday keys", () => {
  assert.equal(weekdayKeyOf("2026-07-20"), "mon");
  assert.equal(weekdayKeyOf("2026-07-22"), "wed");
  assert.equal(weekdayKeyOf("2026-07-26"), "sun");
});

test("weekDays: seven dated Mon→Sun cells", () => {
  const days = weekDays("2026-07-20");
  assert.equal(days.length, 7);
  assert.equal(days[0].key, "mon");
  assert.equal(days[0].date, "2026-07-20");
  assert.equal(days[6].key, "sun");
  assert.equal(days[6].date, "2026-07-26");
});

test("weekLabel: spans the Monday to the Sunday (locale-agnostic)", () => {
  assert.equal(weekLabel("2026-07-20"), `${shortDate("2026-07-20")} – ${shortDate("2026-07-26")}`);
});
