process.env.TZ = "UTC";
import { test } from "node:test";
import assert from "node:assert/strict";
import { weeklyReview } from "./review.js";

function state(over = {}) {
  return {
    roadmaps: [{ id: "R", title: "Embedded", archived: false }],
    milestones: [{ id: "m", roadmapId: "R", title: "Basics" }],
    steps: [
      { id: "s1", milestoneId: "m", title: "GPIO", status: "done" },
      { id: "s2", milestoneId: "m", title: "UART", status: "todo" },
    ],
    tasks: [],
    completions: [],
    ...over,
  };
}

test("counts completions, active days, and the 7-day byDay window", () => {
  const r = weeklyReview(
    state({
      completions: [
        { id: "a", day: "2026-06-23", kind: "step", refId: "s1" },
        { id: "b", day: "2026-06-22", kind: "step", refId: "s2" },
        { id: "c", day: "2026-06-10", kind: "step", refId: "s1" }, // out of window
      ],
    }),
    { today: "2026-06-23" },
  );
  assert.equal(r.from, "2026-06-17");
  assert.equal(r.to, "2026-06-23");
  assert.equal(r.completed, 2);
  assert.equal(r.activeDays, 2);
  assert.equal(r.byDay.length, 7);
  assert.equal(r.byDay[r.byDay.length - 1].count, 1); // today
});

test("resolves finished titles + advanced roadmaps, marks removed", () => {
  const r = weeklyReview(
    state({
      completions: [
        { id: "a", day: "2026-06-23", kind: "step", refId: "s1" },
        { id: "b", day: "2026-06-23", kind: "step", refId: "gone" }, // deleted step
      ],
    }),
    { today: "2026-06-23" },
  );
  const titles = r.finished.map((f) => f.title);
  assert.ok(titles.includes("GPIO"));
  assert.ok(titles.includes("(removed)"));
  assert.deepEqual(r.advanced, ["Embedded"]);
});

// completion-row factory for the reflection fixtures: n rows on `day`
const comps = (day, n, refId = "s1", kind = "step") =>
  Array.from({ length: n }, (_, i) => ({ id: `${day}_${i}`, day, kind, refId }));

test("reflection: a standout day wins first", () => {
  const r = weeklyReview(
    state({
      completions: [...comps("2026-06-23", 5), ...comps("2026-06-21", 2)],
    }),
    { today: "2026-06-23" }, // 2026-06-23 is a Tuesday
  );
  assert.equal(r.reflection, "Tuesday was the big one — 5 finished.");
});

test("reflection: a roadmap that clearly led, when no day stands out", () => {
  const r = weeklyReview(
    state({
      completions: [...comps("2026-06-22", 2), ...comps("2026-06-23", 2)], // 2+2, tied days
    }),
    { today: "2026-06-23" },
  );
  assert.equal(r.reflection, "Most of the week went down the Embedded path.");
});

test("reflection: notably faster than last week", () => {
  // task completions with no roadmap link, spread so no day or path dominates
  const r = weeklyReview(
    state({
      completions: [
        ...comps("2026-06-22", 2, "loose", "task"),
        ...comps("2026-06-23", 2, "loose", "task"),
        ...comps("2026-06-14", 2, "loose", "task"), // prior week
      ],
    }),
    { today: "2026-06-23" },
  );
  assert.equal(r.reflection, "Twice last week's pace — 4 finished to last week's 2.");
});

test("reflection: three-times-plus the pace says the real multiple, not 'twice'", () => {
  // 6 finished vs 2 last week, spread so no day or roadmap dominates
  const r = weeklyReview(
    state({
      completions: [
        ...comps("2026-06-21", 2, "loose", "task"),
        ...comps("2026-06-22", 2, "loose", "task"),
        ...comps("2026-06-23", 2, "loose", "task"),
        ...comps("2026-06-14", 2, "loose", "task"), // prior week
      ],
    }),
    { today: "2026-06-23" },
  );
  assert.equal(r.reflection, "3× last week's pace — 6 finished to last week's 2.");
});

test("reflection: a lighter week stays gentle — never shaming", () => {
  const r = weeklyReview(
    state({
      completions: [
        ...comps("2026-06-23", 1, "loose", "task"),
        ...comps("2026-06-21", 1, "loose", "task"),
        ...comps("2026-06-14", 6, "loose", "task"), // prior week was big
      ],
    }),
    { today: "2026-06-23" },
  );
  assert.equal(
    r.reflection,
    "A lighter week than last — and that's fine; 2 finished still moved the path.",
  );
});

test("reflection: a quiet week gets the gentle line", () => {
  const r = weeklyReview(state(), { today: "2026-06-23" });
  assert.equal(r.reflection, "A quiet week on the path — one step gets it moving.");
});

test("reflection: an ordinary week says nothing at all", () => {
  const r = weeklyReview(state({ completions: comps("2026-06-23", 1, "loose", "task") }), {
    today: "2026-06-23",
  });
  assert.equal(r.reflection, null);
});

test("flags slipped: overdue tasks and past-due roadmaps", () => {
  const r = weeklyReview(
    state({
      roadmaps: [{ id: "R", title: "Embedded", archived: false, targetDate: "2026-06-01" }],
      tasks: [{ id: "t", status: "todo", due: "2026-06-10" }],
    }),
    { today: "2026-06-23" },
  );
  assert.ok(r.slipped.some((s) => /overdue/.test(s)));
  assert.ok(r.slipped.some((s) => /passed its finish date/.test(s)));
});
