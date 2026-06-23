import { test } from "node:test";
import assert from "node:assert/strict";
import { createQueue } from "../src/lib/queue.js";

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

test("jobs run strictly serially — never overlap — and in FIFO order", async () => {
  const enqueue = createQueue();
  let active = 0;
  let maxActive = 0;
  const order = [];
  const runs = [];

  // fire 50 jobs "simultaneously" with random durations
  for (let i = 0; i < 50; i++) {
    runs.push(
      enqueue(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await delay(Math.floor(Math.random() * 5));
        order.push(i);
        active -= 1;
        return i;
      }),
    );
  }
  const results = await Promise.all(runs);
  assert.equal(maxActive, 1, "two jobs ran at once");
  assert.deepEqual(
    order,
    Array.from({ length: 50 }, (_, i) => i),
    "jobs ran out of order",
  );
  assert.deepEqual(
    results,
    Array.from({ length: 50 }, (_, i) => i),
  );
});

test("busy toggles true on first enqueue and false only after all settle", async () => {
  const events = [];
  const enqueue = createQueue((b) => events.push(b));
  const a = enqueue(async () => {
    await delay(5);
  });
  const b = enqueue(async () => {
    await delay(5);
  });
  assert.equal(events[0], true, "busy did not go true");
  await Promise.all([a, b]);
  assert.equal(events[events.length - 1], false, "busy did not return false");
  // only one true and one false across a contiguous batch
  assert.equal(events.filter(Boolean).length, 1);
});

test("a throwing job rejects to its caller but does not poison the chain", async () => {
  const enqueue = createQueue();
  const bad = enqueue(async () => {
    throw new Error("boom");
  });
  await assert.rejects(bad, /boom/);
  const good = await enqueue(async () => "ok");
  assert.equal(good, "ok");
});

test("busy returns to false even after a failing job", async () => {
  const events = [];
  const enqueue = createQueue((b) => events.push(b));
  await enqueue(async () => {
    throw new Error("x");
  }).catch(() => {});
  await delay(0);
  assert.equal(events[events.length - 1], false);
});
