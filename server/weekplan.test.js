// weekplan.test.js — the Claude round-trip for the week layer.
process.env.TZ = "UTC";
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";

const DB = join(tmpdir(), `michi-week-test-${process.pid}.db`);
process.env.MICHI_DB = DB;

const db = await import("./db.js");
const { renderWeekExport, parseWeekPlan, previewWeekPlan, applyWeekPlan, hasWeekPlan } =
  await import("./weekplan.js");

test.after(() => {
  for (const ext of ["", "-wal", "-shm"]) {
    try {
      rmSync(DB + ext);
    } catch {
      /* ignore */
    }
  }
});

const REPLY = `
Sounds good — here's a plan for the week:

\`\`\`
## Japanese
theme: consolidate chapter 3
goal: Japanese N1
days:
- Mon: grammar review
- Wed: listening practice
- Fri: mock test
targets:
- [ ] finish chapter 3
- [x] 20 new kanji

## Climbing
days:
- Tue: bouldering session
- Thu: hangboard
targets:
- [ ] project a V4
\`\`\`

Let me know if you want to shift anything.
`;

test("parseWeekPlan reads the fenced block into area drafts", () => {
  const parsed = parseWeekPlan(REPLY, { goals: [{ id: "g_jp", title: "Japanese N1" }] });
  assert.equal(parsed.plans.length, 2);
  const [jp, climb] = parsed.plans;
  assert.equal(jp.area, "Japanese");
  assert.equal(jp.theme, "consolidate chapter 3");
  assert.equal(jp.goalId, "g_jp"); // resolved by title
  assert.deepEqual(Object.keys(jp.days), ["mon", "wed", "fri"]);
  assert.equal(jp.days.wed.focus, "listening practice");
  assert.deepEqual(jp.targets, [
    { text: "finish chapter 3", done: false },
    { text: "20 new kanji", done: true },
  ]);
  assert.equal(climb.area, "Climbing");
  assert.equal(climb.targets.length, 1);
  assert.ok(hasWeekPlan(parsed));
});

test("parseWeekPlan warns on an unresolved goal but keeps the area", () => {
  const parsed = parseWeekPlan("## X\ngoal: Nonesuch\ndays:\n- Mon: a", { goals: [] });
  assert.equal(parsed.plans[0].goalId, null);
  assert.ok(parsed.warnings.some((w) => w.includes("Nonesuch")));
});

test("previewWeekPlan summarizes areas", () => {
  const parsed = parseWeekPlan(REPLY, {});
  const preview = previewWeekPlan(parsed);
  assert.deepEqual(preview.areas[0], {
    area: "Japanese",
    theme: "consolidate chapter 3",
    days: 3,
    targets: 2,
  });
});

test("applyWeekPlan replaces the chosen week wholesale and preserves other weeks", () => {
  db.resetAll();
  // seed: a goal + an existing plan this week + a plan in a different week
  db.putState({
    goals: [{ id: "g_jp", title: "Japanese N1" }],
    weekPlans: [
      { id: "old", weekStart: "2026-07-20", area: "Old area", days: {}, targets: [] },
      { id: "keep", weekStart: "2026-07-13", area: "Last week", days: {}, targets: [] },
    ],
  });

  const { state, applied, warnings } = applyWeekPlan(REPLY, { weekStart: "2026-07-22" });
  assert.equal(applied.areas, 2);
  assert.equal(warnings.length, 0); // goal resolved cleanly

  const thisWeek = state.weekPlans.filter((w) => w.weekStart === "2026-07-20");
  assert.deepEqual(thisWeek.map((w) => w.area).sort(), ["Climbing", "Japanese"]);
  assert.ok(!state.weekPlans.some((w) => w.id === "old")); // the old plan was replaced
  assert.equal(state.weekPlans.find((w) => w.area === "Japanese").goalId, "g_jp");
  // a different week is untouched
  assert.ok(state.weekPlans.some((w) => w.id === "keep"));
});

test("renderWeekExport frames the week and echoes an existing plan", () => {
  const md = renderWeekExport(db.getFullState(), { weekStart: "2026-07-22" });
  assert.ok(md.includes("2026-07-20")); // snapped to Monday
  assert.ok(/## Japanese/.test(md));
  assert.ok(md.includes("goal: Japanese N1"));
});
