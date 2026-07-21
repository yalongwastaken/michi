// focus.test.js — web-push subscriptions, focus-block reminders, and the goal
// suggestion. Uses a throwaway DB via MICHI_DB (set before importing db.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";

const DB = join(tmpdir(), `michi-focus-test-${process.pid}.db`);
process.env.MICHI_DB = DB;

const db = await import("./db.js");
const focus = await import("./focus.js");

test.after(() => {
  for (const ext of ["", "-wal", "-shm"]) {
    try {
      rmSync(DB + ext);
    } catch {
      /* ignore */
    }
  }
});

test("vapidKeys generates once and persists", () => {
  const a = focus.vapidKeys();
  assert.ok(a.publicKey && a.privateKey);
  const b = focus.vapidKeys();
  assert.deepEqual(a, b); // stable across calls (read back from meta)
});

test("addSubscription validates hard and is idempotent by endpoint", () => {
  db.setPushSubs([]);
  const good = { endpoint: "https://push.example.com/x", keys: { p256dh: "aa", auth: "bb" } };
  assert.equal(focus.addSubscription(good).ok, true);
  // http endpoint is refused (every real push service is https)
  assert.match(
    focus.addSubscription({ endpoint: "http://evil/x", keys: { p256dh: "a", auth: "b" } }).error,
    /https/,
  );
  // missing keys refused
  assert.ok(focus.addSubscription({ endpoint: "https://p/x" }).error);
  // re-subscribing the same endpoint doesn't duplicate
  focus.addSubscription(good);
  assert.equal(focus.subscriptionCount(), 1);
  assert.equal(focus.removeSubscription(good.endpoint).removed, 1);
  assert.equal(focus.subscriptionCount(), 0);
});

test("scheduleReminder rejects out-of-range times, cancel removes", () => {
  db.setFocusReminders([]);
  const now = 1_000_000_000_000;
  assert.match(focus.scheduleReminder({ dueAt: now - 60_000 }, now).error, /24 hours/);
  assert.match(focus.scheduleReminder({ dueAt: now + 48 * 3600_000 }, now).error, /24 hours/);
  assert.match(focus.scheduleReminder({ dueAt: "nope" }, now).error, /timestamp/);
  const { id } = focus.scheduleReminder({ dueAt: now + 60_000, title: "t", body: "b" }, now);
  assert.ok(id);
  assert.equal(db.getFocusReminders().length, 1);
  focus.cancelReminder(id);
  assert.equal(db.getFocusReminders().length, 0);
});

test("focusTick fires due reminders, keeps pending, drops stale", async () => {
  db.setPushSubs([]); // no subs → sendToAll is a no-op, so we can assert on the store
  const now = 2_000_000_000_000;
  db.setFocusReminders([
    { id: "due", dueAt: now - 1000, title: "d", body: "d" }, // just due → fires
    { id: "stale", dueAt: now - 20 * 60_000, title: "s", body: "s" }, // long past → dropped
    { id: "later", dueAt: now + 60_000, title: "l", body: "l" }, // pending → kept
  ]);
  const out = await focus.focusTick(now);
  assert.equal(out.fired, 1);
  assert.equal(out.stale, 1);
  const left = db.getFocusReminders();
  assert.deepEqual(
    left.map((r) => r.id),
    ["later"],
  );
  // nothing due → null (no work)
  assert.equal(await focus.focusTick(now), null);
});

test("deterministicGoal phrases from the chosen targets", () => {
  assert.match(focus.deterministicGoal([]), /focused block/i);
  assert.match(focus.deterministicGoal([{ title: "UART driver" }]), /UART driver/);
  const many = focus.deterministicGoal([{ title: "A" }, { title: "B" }, { title: "C" }]);
  assert.match(many, /“A”/);
  assert.match(many, /“C”/);
});

test("suggestFocusGoal falls back deterministically when the model is off", async () => {
  process.env.MICHI_LLM = "0";
  const out = await focus.suggestFocusGoal([{ title: "SPI" }]);
  assert.match(out, /SPI/);
  delete process.env.MICHI_LLM;
});

test("suggestFocusGoal uses the model's line when enabled", async () => {
  process.env.MICHI_LLM = "1";
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({ message: { content: '"Ship the UART echo test."\n' } }),
  });
  const out = await focus.suggestFocusGoal([{ title: "UART" }], { fetch: fakeFetch });
  assert.equal(out, "Ship the UART echo test."); // quotes/newline trimmed
  // a model error falls back, never throws
  const bad = await focus.suggestFocusGoal([{ title: "UART" }], {
    fetch: async () => {
      throw new Error("down");
    },
  });
  assert.match(bad, /UART/);
  delete process.env.MICHI_LLM;
});
