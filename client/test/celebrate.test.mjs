// celebrate.test.mjs — the celebration record: each checker gates its first look
// on ITS OWN fields, the daruma ritual fires only on an OBSERVED below-100 → 100
// transition (once ever per roadmap), and the shared record round-trips between
// the two checkers without dropping either side's ledger. No localStorage in node,
// so these ride celebrate.js's in-memory fallback — each test imports a fresh,
// cache-busted module instance so one test's record can't leak into the next.
import test from "node:test";
import assert from "node:assert/strict";

let n = 0;
const fresh = () => import(`../src/lib/celebrate.js?fresh=${++n}`);

// a dated roadmap as roadmapTree hands it over — `complete` is the exact
// done===total flag; pct is display-only and the ritual must never key on it
const dated = (id, title, complete) => ({
  id,
  title,
  targetDate: "2026-09-01",
  pct: complete ? 100 : 90,
  complete,
});

test("daruma ritual: seeds silently, fires once per observed crossing", async () => {
  const { checkRituals, checkCelebrations } = await fresh();

  // the very first look must stay quiet even at 100% — no fireworks for history…
  assert.equal(checkRituals([dated("r1", "Embedded", true)]), null);
  // …and that completion is now on the ledger, so it can never fire late
  assert.equal(checkRituals([dated("r1", "Embedded", true)]), null);

  // a roadmap observed in progress DOES fire when it crosses, once, with the daruma
  const two = [dated("r1", "Embedded", true), dated("r2", "Kernel", false)];
  assert.equal(checkRituals(two), null);
  two[1] = dated("r2", "Kernel", true);
  const ev = checkRituals(two);
  assert.equal(ev.headline, "Both eyes open — Kernel walked.");
  assert.equal(ev.species, "daruma");
  assert.equal(ev.eyesFilled, true);

  // never again — even after dipping below 100 and re-finishing
  assert.equal(checkRituals(two), null);
  two[1] = dated("r2", "Kernel", false);
  assert.equal(checkRituals(two), null);
  two[1] = dated("r2", "Kernel", true);
  assert.equal(checkRituals(two), null);

  // undated roadmaps never enter the ritual
  assert.equal(
    checkRituals([{ id: "r3", title: "Loose", targetDate: null, pct: 100, complete: true }]),
    null,
  );

  // a momentum check rewrites the shared record — the ritual ledgers must survive it
  checkCelebrations({ day: "2026-07-13", metGoal: false, milestones: [], xp: null });
  assert.equal(checkRituals(two), null); // r1 + r2 still remembered → still quiet
});

test("a dated roadmap that arrives already complete (import) never fires", async () => {
  const { checkRituals } = await fresh();
  // r1 is being walked — ledgered on sight, below 100
  assert.equal(checkRituals([dated("r1", "Embedded", false)]), null);
  // an import lands r2 already finished: no observed crossing → no fireworks,
  // even though the record already exists and r2 was never on any ledger
  assert.equal(checkRituals([dated("r1", "Embedded", false), dated("r2", "Kernel", true)]), null);
  // r2 stays quiet forever, while r1 — watched in progress all along — still fires
  const done = [dated("r1", "Embedded", true), dated("r2", "Kernel", true)];
  const ev = checkRituals(done);
  assert.equal(ev.headline, "Both eyes open — Embedded walked.");
  assert.equal(checkRituals(done), null);
});

test("celebrations' first look stays silent when rituals seeded the record first", async () => {
  const { checkRituals, checkCelebrations } = await fresh();
  // Roadmaps renders first: the record now exists, but only with the ritual ledgers
  assert.equal(checkRituals([dated("r1", "Embedded", false)]), null);
  // existing momentum — an earned badge, today's goal met — must still be a silent
  // first look for checkCelebrations, gated on ITS OWN fields, not "any record"
  const momentum = {
    day: "2026-07-13",
    metGoal: true,
    todayCount: 3,
    milestones: [{ days: 7, earned: true }],
    xp: { level: 2, name: "Ridge", totalM: 4200 },
  };
  assert.equal(checkCelebrations(momentum), null);
  // …and the seed took: the same momentum stays quiet on the next look…
  assert.equal(checkCelebrations(momentum), null);
  // …while a genuinely new badge still fires
  const ev = checkCelebrations({
    ...momentum,
    milestones: [
      { days: 7, earned: true },
      { days: 14, earned: true },
    ],
  });
  assert.equal(ev.headline, "14-day streak!");
  // and the momentum writes never dropped the ritual ledgers — r1 still fires once
  const rit = checkRituals([dated("r1", "Embedded", true)]);
  assert.equal(rit.headline, "Both eyes open — Embedded walked.");
  assert.equal(checkRituals([dated("r1", "Embedded", true)]), null);
});
