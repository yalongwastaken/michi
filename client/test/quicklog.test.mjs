// quicklog.test.mjs — the spoken-style time-log parser. Times, durations, meridiem
// carry, and (crucially) NOT eating bare numbers that are really part of the title.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseQuickLog, minLabel, durLabel } from "../src/lib/quicklog.js";

test("plain 24h-ish range", () => {
  const r = parseQuickLog("studied SPI 9-11");
  assert.equal(r.title, "studied SPI");
  assert.equal(r.startMin, 9 * 60);
  assert.equal(r.endMin, 11 * 60);
  assert.equal(r.minutes, 120);
});

test("meridiem range with minutes carries pm to the start", () => {
  const r = parseQuickLog("Blinky firmware 2pm-3:30");
  assert.equal(r.title, "Blinky firmware");
  assert.equal(r.startMin, 14 * 60);
  assert.equal(r.endMin, 15 * 60 + 30);
});

test("24h explicit range", () => {
  const r = parseQuickLog("planning 14:00-15:00");
  assert.equal(r.title, "planning");
  assert.equal(r.startMin, 840);
  assert.equal(r.endMin, 900);
});

test("start time + duration", () => {
  const r = parseQuickLog("standup 9:30am for 15m");
  assert.equal(r.title, "standup");
  assert.equal(r.startMin, 570);
  assert.equal(r.endMin, 585);
});

test("duration only → untimed with minutes", () => {
  const r = parseQuickLog("read datasheet 90m");
  assert.equal(r.title, "read datasheet");
  assert.equal(r.startMin, null);
  assert.equal(r.endMin, null);
  assert.equal(r.minutes, 90);
});

test("1h30 style duration", () => {
  const r = parseQuickLog("deep work 1h30");
  assert.equal(r.minutes, 90);
});

test("a bare number in the title is NOT a time", () => {
  const r = parseQuickLog("read chapter 3");
  assert.equal(r.title, "read chapter 3");
  assert.equal(r.startMin, null);
  assert.equal(r.minutes, null);
});

test("no time at all → whole line is the title", () => {
  const r = parseQuickLog("cleaned the desk");
  assert.equal(r.title, "cleaned the desk");
  assert.equal(r.startMin, null);
});

test("labels format for display", () => {
  assert.equal(minLabel(570), "9:30 AM");
  assert.equal(minLabel(840), "2:00 PM");
  assert.equal(minLabel(0), "12:00 AM");
  assert.equal(durLabel(90), "1h 30m");
  assert.equal(durLabel(45), "45m");
});
