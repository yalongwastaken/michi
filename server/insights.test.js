process.env.TZ = "UTC";
import { test } from "node:test";
import assert from "node:assert/strict";
import { insights } from "./insights.js";

function state(over = {}) {
  return {
    roadmaps: [],
    milestones: [],
    steps: [],
    tasks: [],
    completions: [],
    ...over,
  };
}

test("flags overdue tasks", () => {
  const s = state({
    tasks: [
      { id: "a", status: "todo", due: "2026-06-20" },
      { id: "b", status: "todo", due: "2026-06-19" },
    ],
  });
  const out = insights(s, { today: "2026-06-23" });
  const o = out.find((i) => i.kind === "overdue");
  assert.ok(o);
  assert.match(o.text, /2 tasks overdue/);
});

test("flags a near-done roadmap", () => {
  const s = state({
    roadmaps: [{ id: "R", title: "Embedded", archived: false }],
    milestones: [{ id: "m", roadmapId: "R", title: "M" }],
    steps: [
      { id: "s1", milestoneId: "m", status: "done" },
      { id: "s2", milestoneId: "m", status: "done" },
      { id: "s3", milestoneId: "m", status: "done" },
      { id: "s4", milestoneId: "m", status: "done" },
      { id: "s5", milestoneId: "m", status: "todo" }, // 4/5 = 80%
    ],
  });
  const o = insights(s, { today: "2026-06-23" }).find((i) => i.kind === "near-done");
  assert.ok(o);
  assert.match(o.text, /80% done/);
});

test("flags a neglected roadmap (untouched ≥ 7 days)", () => {
  const s = state({
    roadmaps: [{ id: "R", title: "Linux", archived: false }],
    milestones: [{ id: "m", roadmapId: "R", title: "M" }],
    steps: [
      { id: "s1", milestoneId: "m", status: "done" },
      { id: "s2", milestoneId: "m", status: "todo" },
    ],
    completions: [{ id: "c", day: "2026-06-10", kind: "step", refId: "s1" }],
  });
  const o = insights(s, { today: "2026-06-23" }).find((i) => i.kind === "neglected");
  assert.ok(o);
  assert.match(o.text, /hasn't moved in 13 days/);
});

test("doesn't nag about a brand-new roadmap", () => {
  const s = state({
    roadmaps: [{ id: "R", title: "New", archived: false, createdAt: "2026-06-22T00:00:00Z" }],
    milestones: [{ id: "m", roadmapId: "R", title: "M" }],
    steps: [{ id: "s1", milestoneId: "m", status: "todo" }],
  });
  const out = insights(s, { today: "2026-06-23" });
  assert.equal(
    out.find((i) => i.kind === "neglected"),
    undefined,
  );
});
