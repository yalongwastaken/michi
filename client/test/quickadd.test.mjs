import { test } from "node:test";
import assert from "node:assert/strict";
import { parseQuickAdd } from "../src/lib/quickadd.js";

const TODAY = "2026-06-23"; // a Tuesday

test("parses duration + tomorrow", () => {
  const r = parseQuickAdd("read SPI docs 30m tomorrow", { today: TODAY });
  assert.equal(r.title, "read SPI docs");
  assert.equal(r.estMin, 30);
  assert.equal(r.due, "2026-06-24");
  assert.equal(r.recurrence, null);
});

test("hours convert to minutes", () => {
  assert.equal(parseQuickAdd("deep work 2h", { today: TODAY }).estMin, 120);
  assert.equal(parseQuickAdd("review 1 hour", { today: TODAY }).estMin, 60);
});

test("today / tonight → today", () => {
  assert.equal(parseQuickAdd("ship it today", { today: TODAY }).due, TODAY);
  assert.equal(parseQuickAdd("read tonight", { today: TODAY }).due, TODAY);
});

test("in N days", () => {
  assert.equal(parseQuickAdd("call vendor in 3 days", { today: TODAY }).due, "2026-06-26");
});

test("weekday resolves to the next occurrence", () => {
  // Tue 06-23 → next Monday is 06-29
  const r = parseQuickAdd("standup prep on monday", { today: TODAY });
  assert.equal(r.due, "2026-06-29");
  assert.equal(r.title, "standup prep");
});

test("recurrence words", () => {
  assert.equal(parseQuickAdd("read every day", { today: TODAY }).recurrence, "daily");
  assert.equal(parseQuickAdd("standup weekdays", { today: TODAY }).recurrence, "weekdays");
  assert.equal(parseQuickAdd("review weekly", { today: TODAY }).recurrence, "weekly");
});

test("ISO date is honored", () => {
  assert.equal(parseQuickAdd("submit 2026-07-01", { today: TODAY }).due, "2026-07-01");
});

test("does not throw on absurd inputs (regression: Date overflow / giant regex)", () => {
  assert.doesNotThrow(() => parseQuickAdd("finish in 999999999 days", { today: TODAY }));
  assert.doesNotThrow(() => parseQuickAdd("x " + "1".repeat(100000) + " min", { today: TODAY }));
  // a 5+ digit duration isn't treated as a duration (stays in title), no Infinity
  const r = parseQuickAdd("read " + "9".repeat(400) + "h", { today: TODAY });
  assert.notEqual(r.estMin, Infinity);
});

test("invalid calendar dates are not accepted as due", () => {
  const r = parseQuickAdd("submit 2024-13-45", { today: TODAY });
  assert.equal(r.due, null); // structurally date-shaped but not a real day
});

test("plain text stays as the title", () => {
  const r = parseQuickAdd("learn about interrupts", { today: TODAY });
  assert.equal(r.title, "learn about interrupts");
  assert.equal(r.due, null);
  assert.equal(r.estMin, null);
});
