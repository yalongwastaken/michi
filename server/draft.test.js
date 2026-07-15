// draft.test.js — the local-model "structure my notes" layer: prompt shape, mode
// scoping, fence stripping, and graceful failure. No real model is contacted; the
// transport is injected.
process.env.TZ = "UTC";
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDraftMessages, normalizeMode, draftStructured } from "./draft.js";
import { parseSync, hasParsedItems } from "./markdown.js";

test("normalizeMode falls back to auto for anything unknown", () => {
  assert.equal(normalizeMode("roadmap"), "roadmap");
  assert.equal(normalizeMode("tasks"), "tasks");
  assert.equal(normalizeMode("auto"), "auto");
  assert.equal(normalizeMode("nonsense"), "auto");
  assert.equal(normalizeMode(undefined), "auto");
});

test("buildDraftMessages teaches the grammar and scopes by mode", () => {
  const road = buildDraftMessages("some notes", "roadmap", { today: "2026-07-14" });
  assert.match(road.system, /## Roadmap:/);
  assert.match(road.system, /Today is 2026-07-14/);
  assert.match(road.system, /no `## Tasks`/);
  assert.match(road.user, /some notes/);

  const tasks = buildDraftMessages("x", "tasks");
  assert.match(tasks.system, /## Tasks/);
  assert.match(tasks.system, /no `## Roadmap:`/);
});

test("draftStructured returns the model's markdown, fences stripped, and it round-trips", async () => {
  const reply = [
    "Sure! Here you go:",
    "```markdown",
    "## Roadmap: Bare-metal embedded",
    "### Milestone: Fundamentals",
    "- [ ] Blink an LED (GPIO)",
    "- [ ] UART hello world",
    "```",
  ].join("\n");
  const fakeFetch = async () => ({ ok: true, json: async () => ({ message: { content: reply } }) });

  const md = await draftStructured("teach me embedded", "roadmap", {}, { fetch: fakeFetch });
  assert.match(md, /^## Roadmap: Bare-metal embedded/);
  assert.doesNotMatch(md, /```/); // fence + the "Sure!" preamble are stripped
  assert.doesNotMatch(md, /Sure!/);

  // the whole point: the draft flows through the same pipeline as a pasted reply
  const parsed = parseSync(md);
  assert.ok(hasParsedItems(parsed));
  assert.equal(parsed.roadmaps.length, 1);
  assert.equal(parsed.steps.length, 2);
});

test("draftStructured returns null on an unreachable / erroring model", async () => {
  const boom = async () => {
    throw new Error("ECONNREFUSED");
  };
  assert.equal(await draftStructured("x", "auto", {}, { fetch: boom }), null);

  const notOk = async () => ({ ok: false, json: async () => ({}) });
  assert.equal(await draftStructured("x", "auto", {}, { fetch: notOk }), null);

  const empty = async () => ({ ok: true, json: async () => ({ message: { content: "   " } }) });
  assert.equal(await draftStructured("x", "auto", {}, { fetch: empty }), null);
});
