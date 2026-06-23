// planner.fuzz.test.js — property-based fuzzing of the planner. Generates many random
// states and asserts invariants that must hold for ANY input. Deterministic (seeded),
// so a failure is reproducible from the printed seed.
process.env.TZ = "UTC";
import { test } from "node:test";
import assert from "node:assert/strict";
import { planDay } from "./planner.js";

// mulberry32 — tiny seeded PRNG so failures reproduce
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAYS = ["2026-06-21", "2026-06-23", "2026-07-01", "2026-05-30", "2026-12-31"];
const STATUSES = ["todo", "doing", "done"];
const RECUR = [null, null, "daily", "weekdays", "weekly"];

function genState(r) {
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const n = (max) => Math.floor(r() * max);

  const roadmaps = [];
  const milestones = [];
  const steps = [];
  const nR = n(5);
  for (let i = 0; i < nR; i++) {
    const rid = `R${i}`;
    roadmaps.push({
      id: rid,
      title: `RM${i}`,
      archived: r() < 0.2,
      position: i,
      createdAt: "2026-01-01T00:00:00Z",
      targetDate: r() < 0.4 ? pick(DAYS) : null,
      stepMinutes: r() < 0.3 ? [0, 10, 25, 45, 60][n(5)] : null,
    });
    const nM = n(4);
    for (let j = 0; j < nM; j++) {
      const mid = `${rid}_m${j}`;
      milestones.push({ id: mid, roadmapId: rid, title: `M${j}`, position: j });
      const nS = n(6);
      for (let k = 0; k < nS; k++) {
        steps.push({
          id: `${mid}_s${k}`,
          milestoneId: mid,
          title: `S${k}`,
          status: pick(STATUSES),
          position: k,
        });
      }
    }
  }

  const tasks = [];
  const nT = n(8);
  for (let i = 0; i < nT; i++) {
    tasks.push({
      id: `t${i}`,
      title: `T${i}`,
      status: pick(STATUSES),
      due: r() < 0.5 ? pick(DAYS) : null,
      recurrence: pick(RECUR),
      estMin: r() < 0.5 ? [0, 5, 15, 30, 90][n(5)] : null,
      doneAt: r() < 0.3 ? "2026-06-23T10:00:00Z" : null,
    });
  }
  return { roadmaps, milestones, steps, tasks, projects: [], completions: [], settings: {} };
}

test("planner invariants hold across 600 random states", () => {
  for (let i = 0; i < 600; i++) {
    const r = rng(i + 1);
    const state = genState(r);
    const budgetMin = [0, 15, 60, 240, -5][i % 5];
    const today = DAYS[i % DAYS.length];

    let plan;
    assert.doesNotThrow(
      () => {
        plan = planDay(state, { today, budgetMin });
      },
      `threw on seed ${i + 1}`,
    );

    // shape
    assert.ok(Array.isArray(plan.items), `seed ${i + 1}: items not array`);

    // no duplicate item keys
    const keys = plan.items.map((it) => `${it.kind}:${it.id}`);
    assert.equal(new Set(keys).size, keys.length, `seed ${i + 1}: duplicate items`);

    // plannedMin equals the sum of item estimates
    const sum = plan.items.reduce((a, it) => a + (it.estMin || 0), 0);
    assert.equal(plan.plannedMin, sum, `seed ${i + 1}: plannedMin != sum estMin`);

    // every item references a real, eligible underlying row
    const stepById = new Map(state.steps.map((s) => [s.id, s]));
    const taskById = new Map(state.tasks.map((t) => [t.id, t]));
    const liveRoadmap = new Set(state.roadmaps.filter((rm) => !rm.archived).map((rm) => rm.id));
    for (const it of plan.items) {
      if (it.kind === "step") {
        const s = stepById.get(it.id);
        assert.ok(s, `seed ${i + 1}: step ${it.id} missing`);
        assert.notEqual(s.status, "done", `seed ${i + 1}: planned a done step`);
        assert.ok(liveRoadmap.has(it.roadmapId), `seed ${i + 1}: step from archived roadmap`);
      } else {
        assert.ok(taskById.get(it.id), `seed ${i + 1}: task ${it.id} missing`);
      }
    }

    // budget discipline: non-obligation cost never exceeds the budget (obligations are
    // always included regardless; a lone streak-protection item may exceed)
    const isObligation = (it) => it.reason === "due" || it.reason === "overdue";
    const gated = plan.items.filter((it) => !isObligation(it) && it.reason !== "streak");
    const gatedCost = gated.reduce((a, it) => a + (it.estMin || 0), 0);
    assert.ok(
      gatedCost <= Math.max(0, budgetMin),
      `seed ${i + 1}: gated cost ${gatedCost} > budget ${budgetMin}`,
    );
  }
});
