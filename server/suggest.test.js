// suggest.test.js — the optional LLM layer: candidate menu, prompt, parsing, and
// (critically) that it always falls back to the deterministic plan on trouble.
process.env.TZ = "UTC";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCandidates,
  parseChoice,
  refinePlan,
  refineDay,
  parseDayTasks,
  aiEnabled,
} from "./suggest.js";

function sampleState() {
  return {
    roadmaps: [{ id: "R", title: "Embedded", archived: false }],
    milestones: [{ id: "m", roadmapId: "R", title: "Basics", position: 0 }],
    steps: [
      { id: "s1", milestoneId: "m", title: "GPIO", status: "todo", position: 0 },
      { id: "s2", milestoneId: "m", title: "UART", status: "todo", position: 1 },
    ],
    tasks: [{ id: "t1", title: "Read datasheet", status: "todo", due: "2026-06-23" }],
    completions: [],
    settings: {},
  };
}

const draft = { day: "2026-06-23", budgetMin: 60, plannedMin: 30, items: [], counts: {}, why: "x" };

test("buildCandidates lists due tasks + next steps with stable keys", () => {
  const { rows, byKey } = buildCandidates(sampleState(), { today: "2026-06-23" });
  const keys = rows.map((r) => r.key);
  assert.ok(keys.includes("task:t1"));
  assert.ok(keys.includes("step:s1"));
  assert.ok(byKey.get("step:s1").roadmapTitle === "Embedded");
});

test("parseChoice keeps only valid keys, dedupes, tolerates code fences", () => {
  const valid = new Set(["task:t1", "step:s1", "step:s2"]);
  const text = '```json\n{"items":["step:s1","step:s1","nope:x","task:t1"],"why":"good day"}\n```';
  const out = parseChoice(text, valid);
  assert.deepEqual(out.ids, ["step:s1", "task:t1"]);
  assert.equal(out.why, "good day");
});

test("parseChoice returns null on junk or no valid keys", () => {
  assert.equal(parseChoice("not json", new Set(["a"])), null);
  assert.equal(parseChoice('{"items":["bad"]}', new Set(["a"])), null);
});

test("aiEnabled defaults ON when MICHI_LLM is unset", () => {
  delete process.env.MICHI_LLM;
  assert.equal(aiEnabled(), true);
  process.env.MICHI_LLM = "off";
  assert.equal(aiEnabled(), false);
  delete process.env.MICHI_LLM;
});

test("refinePlan returns the draft untouched when disabled", async () => {
  process.env.MICHI_LLM = "0"; // explicit off — the model layer is on by default now
  assert.equal(aiEnabled(), false);
  const out = await refinePlan(sampleState(), draft, {});
  assert.equal(out, draft);
  delete process.env.MICHI_LLM;
});

test("refinePlan uses the model's choice when enabled", async () => {
  process.env.MICHI_LLM = "1";
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({
      message: { content: '{"items":["step:s2","task:t1"],"why":"focus UART"}' },
    }),
  });
  const out = await refinePlan(sampleState(), draft, { today: "2026-06-23" }, { fetch: fakeFetch });
  assert.equal(out.source, "ai");
  assert.deepEqual(
    out.items.map((i) => i.id),
    ["s2", "t1"],
  );
  assert.equal(out.why, "focus UART");
  delete process.env.MICHI_LLM;
});

test("refinePlan resolves the endpoint against MICHI_LLM_URL (no path mangling)", async () => {
  process.env.MICHI_LLM = "1";
  process.env.MICHI_LLM_URL = "http://10.0.0.5:11434/base?x=1";
  let seen = null;
  const capture = async (url) => {
    seen = url;
    return { ok: true, json: async () => ({ message: { content: '{"items":["step:s1"]}' } }) };
  };
  await refinePlan(sampleState(), draft, { today: "2026-06-23" }, { fetch: capture });
  assert.equal(seen, "http://10.0.0.5:11434/api/chat");
  delete process.env.MICHI_LLM;
  delete process.env.MICHI_LLM_URL;
});

test("buildCandidates prices steps with the roadmap's stepMinutes when set", () => {
  const s = sampleState();
  s.roadmaps[0].stepMinutes = 45;
  const { rows, byKey } = buildCandidates(s, { today: "2026-06-23" });
  assert.equal(rows.find((r) => r.key === "step:s1").estMin, 45);
  assert.equal(byKey.get("step:s2").estMin, 45);
  // no stepMinutes → global default still applies
  const plain = buildCandidates(sampleState(), { today: "2026-06-23", defaultStepMin: 30 });
  assert.equal(plain.byKey.get("step:s1").estMin, 30);
});

test("refinePlan recomputes counts for the refined item set", async () => {
  process.env.MICHI_LLM = "1";
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({ message: { content: '{"items":["task:t1","step:s1"]}' } }),
  });
  const stale = { due: 9, pace: 9, continue: 9, rotate: 9 }; // the draft's, for other items
  const out = await refinePlan(
    sampleState(),
    { ...draft, counts: stale },
    { today: "2026-06-23" },
    { fetch: fakeFetch },
  );
  assert.equal(out.source, "ai");
  assert.deepEqual(out.counts, { due: 1, pace: 0, continue: 0, rotate: 1 });
  delete process.env.MICHI_LLM;
});

test("refinePlan falls back to the draft when the model errors/times out", async () => {
  process.env.MICHI_LLM = "1";
  const boom = async () => {
    throw new Error("connection refused");
  };
  const out = await refinePlan(sampleState(), draft, { today: "2026-06-23" }, { fetch: boom });
  assert.equal(out, draft);
  delete process.env.MICHI_LLM;
});

test("parseDayTasks: forgiving parse, clean rows, capped at 5", () => {
  const good = parseDayTasks('{"tasks":[{"title":"warm up","estMin":10},{"title":"drills"}]}');
  assert.deepEqual(good, [
    { title: "warm up", estMin: 10 },
    { title: "drills", estMin: 25 },
  ]);
  // tolerates prose around the JSON, drops blank titles / bad estMin
  const messy = parseDayTasks('sure!\n{"tasks":[{"title":"  ok  ","estMin":-3},{"title":""}]}');
  assert.deepEqual(messy, [{ title: "ok", estMin: 25 }]);
  assert.deepEqual(parseDayTasks("not json"), []);
  assert.equal(
    parseDayTasks(
      `{"tasks":${JSON.stringify(Array.from({ length: 9 }, (_, i) => ({ title: `t${i}` })))}}`,
    ).length,
    5,
  );
});

test("refineDay: uses the model when enabled, attributes nothing", async () => {
  process.env.MICHI_LLM = "1";
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({ message: { content: '{"tasks":[{"title":"20 kanji","estMin":30}]}' } }),
  });
  const out = await refineDay("vocab", { area: "Japanese" }, { fetch: fakeFetch });
  assert.equal(out.source, "ai");
  assert.deepEqual(out.tasks, [{ title: "20 kanji", estMin: 30 }]);
  delete process.env.MICHI_LLM;
});

test("refineDay: falls back to the focus itself when the model is off/unreachable", async () => {
  delete process.env.MICHI_LLM; // on by default, but no fetch given → transport throws
  const boom = async () => {
    throw new Error("connection refused");
  };
  const out = await refineDay("listening practice", { taskDefaultMin: 20 }, { fetch: boom });
  assert.deepEqual(out, {
    tasks: [{ title: "listening practice", estMin: 20 }],
    source: "fallback",
  });
  // empty focus → nothing
  assert.deepEqual(await refineDay("   "), { tasks: [], source: "fallback" });
});
