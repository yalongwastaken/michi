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
