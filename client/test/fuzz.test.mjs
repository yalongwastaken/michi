// fuzz.test.mjs — the parsers must never throw, whatever garbage is pasted/typed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRoadmap } from "../src/lib/parse.js";
import { parseQuickAdd } from "../src/lib/quickadd.js";

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALPHABET =
  "abc 0123-#*[]()hmin daily weekly weekdays tomorrow today in days monday \n\t`_*xX:/.";

function randomString(r, maxLen) {
  const len = Math.floor(r() * maxLen);
  let s = "";
  for (let i = 0; i < len; i++) {
    s += ALPHABET[Math.floor(r() * ALPHABET.length)];
  }
  return s;
}

test("parseQuickAdd never throws on random input", () => {
  for (let i = 0; i < 2000; i++) {
    const r = rng(i + 1);
    const s = randomString(r, 80);
    assert.doesNotThrow(
      () => {
        const out = parseQuickAdd(s, { today: "2026-06-23" });
        assert.equal(typeof out.title, "string");
        assert.ok(out.estMin === null || Number.isFinite(out.estMin));
        assert.ok(out.due === null || /^\d{4}-\d{2}-\d{2}$/.test(out.due));
      },
      `quickadd threw on: ${JSON.stringify(s)}`,
    );
  }
});

test("parseQuickAdd handles adversarial numeric/date tokens", () => {
  for (const s of [
    "in 999999999999 days",
    "in 0 days",
    "9999999999999999999h",
    "30m 45min 2h every day weekly",
    "2026-02-30",
    "-".repeat(5000),
    "in days",
    "1".repeat(50000) + "min",
  ]) {
    assert.doesNotThrow(
      () => parseQuickAdd(s, { today: "2026-06-23" }),
      `threw on ${s.slice(0, 20)}`,
    );
  }
});

test("parseRoadmap never throws on random/pathological markdown", () => {
  for (let i = 0; i < 1000; i++) {
    const r = rng(i + 9999);
    const s = randomString(r, 400);
    assert.doesNotThrow(() => {
      const out = parseRoadmap(s);
      assert.equal(typeof out.title, "string");
      assert.ok(Array.isArray(out.milestones));
      assert.equal(typeof out.stepCount, "number");
    }, `parseRoadmap threw on len ${s.length}`);
  }
  // pathological shapes
  for (const s of [
    "#".repeat(10000),
    "- ".repeat(20000),
    "```\n".repeat(5000),
    "[](".repeat(5000),
  ]) {
    assert.doesNotThrow(() => parseRoadmap(s));
  }
});
