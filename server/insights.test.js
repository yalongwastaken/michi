process.env.TZ = "UTC";
import { test } from "node:test";
import assert from "node:assert/strict";
import { insights, kataSuggestions } from "./insights.js";

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

test("flags deadline pressure when >1 step/day is needed", () => {
  const s = state({
    roadmaps: [{ id: "R", title: "Embedded", archived: false, targetDate: "2026-06-25" }],
    milestones: [{ id: "m", roadmapId: "R", title: "M" }],
    steps: [
      { id: "s1", milestoneId: "m", status: "todo" },
      { id: "s2", milestoneId: "m", status: "todo" },
      { id: "s3", milestoneId: "m", status: "todo" },
      { id: "s4", milestoneId: "m", status: "todo" },
    ],
  });
  // today=06-23 → 3 days, 4 steps → ~2/day
  const o = insights(s, { today: "2026-06-23" }).find((i) => i.kind === "deadline");
  assert.ok(o);
  assert.match(o.text, /3 days left, ~2\/day/);
});

test("flags a past-due roadmap", () => {
  const s = state({
    roadmaps: [{ id: "R", title: "Linux", archived: false, targetDate: "2026-06-01" }],
    milestones: [{ id: "m", roadmapId: "R", title: "M" }],
    steps: [{ id: "s1", milestoneId: "m", status: "todo" }],
  });
  const o = insights(s, { today: "2026-06-23" }).find((i) => i.kind === "deadline");
  assert.ok(o);
  assert.match(o.text, /past its finish date/);
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

// ── kata suggestions ────────────────────────────────────────────────────────────

// a completion at a given local time (TZ pinned to UTC above)
const at = (day, time, i = 0) => ({
  id: `c${day}${time}${i}`,
  day,
  kind: "task",
  refId: `t${i}`,
  ts: `${day}T${time}:00Z`,
});

test("kata: three late-night finishes in a week suggest the shutdown ritual", () => {
  const s = state({
    completions: [
      at("2026-06-20", "22:15", 1),
      at("2026-06-21", "23:05", 2),
      at("2026-06-22", "21:30", 3),
    ],
  });
  const out = kataSuggestions(s, { today: "2026-06-23" });
  const sh = out.find((x) => x.builtinId === "shutdown");
  assert.ok(sh);
  assert.equal(sh.title, "shutdown ritual");
  assert.match(sh.reason, /3 completions after 21:00/);
  // two late nights aren't a pattern yet
  const two = kataSuggestions(state({ completions: s.completions.slice(0, 2) }), {
    today: "2026-06-23",
  });
  assert.ok(!two.some((x) => x.builtinId === "shutdown"));
  // …and a late night from a MONTH ago doesn't count toward this week
  const stale = kataSuggestions(
    state({ completions: [...s.completions.slice(0, 2), at("2026-05-01", "23:00", 9)] }),
    { today: "2026-06-23" },
  );
  assert.ok(!stale.some((x) => x.builtinId === "shutdown"));
});

test("kata: silent mornings across the last active days suggest the first block", () => {
  const s = state({
    completions: [
      at("2026-06-20", "14:00", 1),
      at("2026-06-21", "16:30", 2),
      at("2026-06-22", "19:00", 3),
    ],
  });
  const out = kataSuggestions(s, { today: "2026-06-23" });
  const fb = out.find((x) => x.builtinId === "first-block");
  assert.ok(fb);
  assert.equal(fb.title, "25-minute first block");
  assert.equal(fb.reason, "your mornings are your quietest hours");
  // one morning completion anywhere in those days silences it
  const morning = kataSuggestions(
    state({ completions: [...s.completions, at("2026-06-22", "09:00", 4)] }),
    { today: "2026-06-23" },
  );
  assert.ok(!morning.some((x) => x.builtinId === "first-block"));
  // under 3 active days there isn't enough evidence to call a pattern
  const thin = kataSuggestions(state({ completions: s.completions.slice(0, 2) }), {
    today: "2026-06-23",
  });
  assert.ok(!thin.some((x) => x.builtinId === "first-block"));
});

test("kata: four half-open items suggest the one-tab rule", () => {
  const s = state({
    tasks: [
      { id: "a", title: "a", status: "doing" },
      { id: "b", title: "b", status: "doing" },
    ],
    steps: [
      { id: "c", milestoneId: "m", status: "doing" },
      { id: "d", milestoneId: "m", status: "doing" },
    ],
  });
  const out = kataSuggestions(s, { today: "2026-06-23" });
  assert.deepEqual(out, [
    { builtinId: "one-tab", title: "one-tab rule", reason: "a lot of things are half-open" },
  ]);
  // three half-open things are still within reason
  const three = kataSuggestions(state({ ...s, steps: s.steps.slice(0, 1) }), {
    today: "2026-06-23",
  });
  assert.deepEqual(three, []);
});

test("kata: builtins already added (even retired) are never re-offered; cap is 2", () => {
  const busy = {
    completions: [
      at("2026-06-20", "22:15", 1),
      at("2026-06-21", "23:05", 2),
      at("2026-06-22", "21:30", 3),
    ],
    tasks: Array.from({ length: 4 }, (_, i) => ({ id: `d${i}`, title: "x", status: "doing" })),
  };
  // all three rules fire — only the first two suggestions ship
  const all = kataSuggestions(state(busy), { today: "2026-06-23" });
  assert.deepEqual(
    all.map((x) => x.builtinId),
    ["shutdown", "first-block"],
  );
  // the user already added (then retired) the shutdown ritual — never re-offered
  const added = kataSuggestions(
    state({
      ...busy,
      kata: [{ id: "k1", title: "shutdown ritual", builtinId: "shutdown", active: false }],
    }),
    { today: "2026-06-23" },
  );
  assert.deepEqual(
    added.map((x) => x.builtinId),
    ["first-block", "one-tab"],
  );
  // quiet data suggests nothing at all
  assert.deepEqual(kataSuggestions(state(), { today: "2026-06-23" }), []);
});

// a kata honor at a given local time — same shape as at(), kind "kata"
const honorAt = (day, time, i = 0) => ({ ...at(day, time, i), kind: "kata" });

test("kata: honors are practice, not evidence — excluded from every rule", () => {
  // three evening kata honors alone must NOT suggest the shutdown ritual
  const evenings = state({
    completions: [
      honorAt("2026-06-20", "22:15", 1),
      honorAt("2026-06-21", "23:05", 2),
      honorAt("2026-06-22", "21:30", 3),
    ],
  });
  assert.deepEqual(kataSuggestions(evenings, { today: "2026-06-23" }), []);
  // honor-only days aren't "active days" for the silent-mornings rule either
  const afternoons = state({
    completions: [
      honorAt("2026-06-20", "14:00", 1),
      honorAt("2026-06-21", "16:30", 2),
      honorAt("2026-06-22", "19:00", 3),
    ],
  });
  assert.deepEqual(kataSuggestions(afternoons, { today: "2026-06-23" }), []);
  // real late-night work still fires — and a MORNING honor riding alongside
  // must not silence the first block (it isn't a morning's work)
  const mixed = state({
    completions: [
      at("2026-06-20", "22:15", 1),
      at("2026-06-21", "23:05", 2),
      at("2026-06-22", "21:30", 3),
      honorAt("2026-06-22", "09:00", 9),
    ],
  });
  assert.deepEqual(
    kataSuggestions(mixed, { today: "2026-06-23" }).map((x) => x.builtinId),
    ["shutdown", "first-block"],
  );
});
