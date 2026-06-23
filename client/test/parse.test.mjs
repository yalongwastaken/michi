import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRoadmap } from "../src/lib/parse.js";

test("parses H1 title, headings as milestones, list items as steps", () => {
  const md = `# Bare-metal Embedded

## Fundamentals
- Blink an LED
- UART hello world

## Peripherals
- SPI
- I2C
`;
  const r = parseRoadmap(md);
  assert.equal(r.title, "Bare-metal Embedded");
  assert.equal(r.milestones.length, 2);
  assert.equal(r.milestones[0].title, "Fundamentals");
  assert.deepEqual(
    r.milestones[0].steps.map((s) => s.title),
    ["Blink an LED", "UART hello world"],
  );
  assert.equal(r.stepCount, 4);
});

test("checkboxes set step status", () => {
  const md = `## M
- [x] done one
- [ ] todo one
- plain one`;
  const r = parseRoadmap(md);
  const [a, b, c] = r.milestones[0].steps;
  assert.equal(a.status, "done");
  assert.equal(b.status, "todo");
  assert.equal(c.status, "todo");
});

test("extracts a resource link and uses its text as the title", () => {
  const md = `## M
- [Read the UART guide](https://example.com/uart)`;
  const s = parseRoadmap(md).milestones[0].steps[0];
  assert.equal(s.title, "Read the UART guide");
  assert.equal(s.resourceUrl, "https://example.com/uart");
});

test("strips inline markdown and supports numbered + asterisk bullets", () => {
  const md = `## M
1. **First**
* \`code step\`
+ _third_`;
  const titles = parseRoadmap(md).milestones[0].steps.map((s) => s.title);
  assert.deepEqual(titles, ["First", "code step", "third"]);
});

test("list items before any heading go into an implicit Steps milestone", () => {
  const r = parseRoadmap(`- loose one\n- loose two`);
  assert.equal(r.milestones.length, 1);
  assert.equal(r.milestones[0].title, "Steps");
  assert.equal(r.stepCount, 2);
});

test("ignores fenced code and empty headings", () => {
  const md = `# Title
## Empty Section
## Real
- step
\`\`\`
- not a step (in code fence)
\`\`\``;
  const r = parseRoadmap(md);
  assert.equal(r.milestones.length, 1); // empty section dropped
  assert.equal(r.milestones[0].title, "Real");
  assert.equal(r.stepCount, 1);
});

test("title can be overridden and falls back when absent", () => {
  assert.equal(parseRoadmap("- a", { title: "Custom" }).title, "Custom");
  assert.equal(parseRoadmap("- a").title, "Imported roadmap");
});
