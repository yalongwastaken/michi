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

// a minimal momentum payload with a discipline block — grade fields as the
// server's GRADE_LADDER hands them over (n is the TRADITIONAL number: kyū
// counts down toward 1級, dan counts back up)
const withGrade = (day, g) => ({
  day,
  metGoal: false,
  milestones: [],
  xp: null,
  discipline: g ? { cleanDays: 1, cleanStreak: 1, grade: g, week: [] } : undefined,
});
const KYU10 = { n: 10, label: "10級", romaji: "10th kyū", english: "tenth grade" };
const KYU9 = { n: 9, label: "9級", romaji: "9th kyū", english: "ninth grade" };
const KYU1 = { n: 1, label: "1級", romaji: "1st kyū", english: "first grade" };
const SHODAN = { n: 1, label: "初段", romaji: "shodan", english: "first dan" };

test("grade-up: quiet locked toast once per grade, monotonic across kyū AND dan", async () => {
  const { checkCelebrations } = await fresh();
  // first look seeds silently — an existing grade never refires as history
  assert.equal(checkCelebrations(withGrade("2026-07-13", KYU10)), null);
  assert.equal(checkCelebrations(withGrade("2026-07-13", KYU10)), null);
  // kyū progression: n DROPS 10 → 9, but the rank climbs — must fire
  const ev = checkCelebrations(withGrade("2026-07-13", KYU9));
  assert.equal(ev.headline, "9級 — 9th kyū.");
  assert.equal(ev.subline, "ninth grade. The form holds.");
  assert.equal(ev.mood, "locked");
  assert.equal(ev.quiet, true); // discipline is quiet — no confetti
  // dedupe forever
  assert.equal(checkCelebrations(withGrade("2026-07-13", KYU9)), null);
  // the kyū→dan seam: 1級 (n=1) → shodan (n=1) is still a climb
  assert.equal(checkCelebrations(withGrade("2026-07-14", KYU1)).headline, "1級 — 1st kyū.");
  const dan = checkCelebrations(withGrade("2026-07-14", SHODAN));
  assert.equal(dan.headline, "初段 — shodan.");
  // a payload without discipline (older server) must not reset the ledger
  assert.equal(checkCelebrations(withGrade("2026-07-15", undefined)), null);
  assert.equal(checkCelebrations(withGrade("2026-07-15", SHODAN)), null);
});

test("clean day: fires once per day, seeds silently on the first look", async () => {
  const { checkCelebrations } = await fresh();
  const kata = (clean, total = 2) => ({ items: [], today: { honored: total, total, clean } });
  // very first look — even an already-clean day stays quiet (history, not a feat)
  assert.equal(checkCelebrations(withGrade("2026-07-13", KYU10), kata(true)), null);
  // …and it was recorded: the same clean day never refires
  assert.equal(checkCelebrations(withGrade("2026-07-13", KYU10), kata(true)), null);
  // the next day's clean moment fires — quiet, locked, the 型 line
  const ev = checkCelebrations(withGrade("2026-07-14", KYU10), kata(true));
  assert.equal(ev.headline, "clean day — 型 held.");
  assert.equal(ev.mood, "locked");
  assert.equal(ev.quiet, true);
  assert.equal(checkCelebrations(withGrade("2026-07-14", KYU10), kata(true)), null);
  // an empty active set is never "clean", whatever the flag claims
  assert.equal(checkCelebrations(withGrade("2026-07-15", KYU10), kata(true, 0)), null);
  // and a grade-up outranks the same-moment clean day (which still dedupes)
  const both = checkCelebrations(withGrade("2026-07-16", KYU9), kata(true));
  assert.equal(both.headline, "9級 — 9th kyū.");
  assert.equal(checkCelebrations(withGrade("2026-07-16", KYU9), kata(true)), null);
});

test("clean day: the SERVER's clean flag is the judge, never honored/total math", async () => {
  const { checkCelebrations } = await fresh();
  const kata = (clean, honored, total) => ({ items: [], today: { honored, total, clean } });
  checkCelebrations(withGrade("2026-07-13", KYU10), kata(false, 0, 2)); // seed silently
  // App feeds this checker the honor response's kataToday (server truth) — the
  // flag must be trusted verbatim, both ways. clean:false with every chip filled:
  // the day's snapshot holds more forms than are active now — NOT a clean day…
  assert.equal(checkCelebrations(withGrade("2026-07-14", KYU10), kata(false, 2, 2)), null);
  // …and clean:true with chips left over: the snapshot was honored in full before
  // a form activated mid-day — the day IS clean, whatever honored/total says
  const ev = checkCelebrations(withGrade("2026-07-14", KYU10), kata(true, 2, 3));
  assert.equal(ev.headline, "clean day — 型 held.");
  assert.equal(ev.quiet, true);
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
