# Michi — improvement report (2026-07-01)

Full-repo review: server, client, PWA, ops, tests. Previous audit fixes (date validation,
budget clamping, fuzzing, write-queue, a11y) were excluded — everything below is new.
All high/medium findings were verified against the actual code.

---

## Critical (fix first)

### S1. Unvalidated `settings` can wedge the server for hours — HIGH

`validateState()` (db.js:187–244) never checks `settings` or `profile`. A `PUT /api/state`
or import with `settings.streakFreezes: "Infinity"` (or any huge number) reaches
`computeStreak()` (engine.js:223–235), which walks backwards **one day at a time** while
`freezesUsed + pending < freezes` — blocking the single-threaded server on every
`/api/momentum` and `/api/dashboard` call. systemd won't restart it (process is alive,
just wedged).
**Fix:** validate settings/profile in `validateState`, and clamp at use:
`Math.min(Number(settings.streakFreezes) || 0, 365)` at engine.js:296.

### S2. Import can permanently 500 momentum/dashboard — HIGH

`replaceCompletions()` (db.js:564) only checks field _presence_, not validity — no
`isValidDay()`, no kind whitelist. One imported completion with `day: "not-a-date"`
makes `prevDay()` throw `RangeError` inside `longestStreak()` on **every** momentum/
dashboard call until the DB is hand-edited. The date-validation audit covered tasks and
roadmaps but missed the completions log — exactly the data import rebuilds.
**Fix:** `isValidDay(c.day)` + kind whitelist in the import loop.

### S3. Backups are silently broken (WAL) — HIGH

`Makefile:68` does `cp server/data/michi.db backups/...`. The DB runs in WAL mode
(db.js:15), so recent commits live in `michi.db-wal` until checkpoint — a plain `cp`
**misses everything since the last checkpoint** and can produce a torn copy. This is the
only backup mechanism, and it fails silently.
**Fix:** use `sqlite3 michi.db ".backup backups/..."` or `VACUUM INTO` (or Node's
`db.backup()`). Also add a systemd timer so backups don't depend on remembering
`make backup`, and consider copying off-disk.

### C1. Failed completion never rolls back + unhandled rejection — HIGH

App.jsx:182–186: when `POST /api/complete` fails, the catch calls `refreshDerived()` to
roll back the optimistic checkmark — but `refreshDerived` has no try/catch and fails for
the same reason (offline / flaky Tailscale). The exception escapes, the rollback never
happens, and the user sees a ✓ the server never recorded. It silently vanishes on next
reload.
**Fix:** wrap the rollback refresh in its own try/catch; show a clear "not saved" state.

### C2. The app goes stale and never recovers — HIGH

No `visibilitychange` / `focus` / `online` / interval handler exists anywhere in
client/src (only SW registration in main.jsx). As an installed PWA kept alive on a phone
for days, Michi shows **yesterday's** plan, greeting, and streak the next morning — and
`refreshDerived` closes over a stale `day` (App.jsx:59,77), so even a checkbox tap
refetches `?day=<yesterday>`. It also never picks up edits from another device.
**Fix (~15 lines):** refetch on `visibilitychange`→visible and `online`; compute `day`
inside `refreshDerived` at call time.

### C3. One mis-tap permanently deletes a roadmap — HIGH

The roadmap Delete icon (Roadmaps.jsx:374) deletes the roadmap and all milestones/steps
via full-state PUT with **no confirm and no undo**, sitting adjacent to Archive/Edit in
a row of 40px phone tap targets. Same for step, project, and task deletes. The server
keeps no trash; only the completions log survives. Settings→Reset already has a two-tap
confirm (Settings.jsx:156) — deletes deserve the same, or an undo toast.

---

## Medium

### Server

- **S4. Import half-applies on failure.** index.js:254–257 runs `putState` and
  `replaceCompletions` as two separate transactions. If the second throws, tables are
  already replaced, old completions survive, and the client is told the import failed.
  Fold both into one transaction.
- **S5. Extra/odd fields explode at the SQL layer.** db.js binds `{...defaults, ...t}`
  into named-parameter statements; any unknown key or boolean value passes validation
  but throws at insert → generic 400. Strip unknown keys in validation; check duplicate
  ids / dangling `milestoneId` so import errors are actionable.
- **S6. Every write returns the entire state including the unbounded completions log**
  (db.js:369,415,528,548 all `return getState()`). Ticking one checkbox downloads the
  whole history; grows forever. Return a slim `{rev}` ack, or window completions in
  `getState` (momentum needs ~heatDays; export keeps the full log). The client-side twin:
  `save()` also _uploads_ the full log on every edit (see C6).
- **S7. systemd unit runs as root** — no `User=` in deploy/michi.service. Add `User=`,
  and optionally `ProtectSystem=strict` + `ReadWritePaths=` for the data dir.
- **S8. Duplication drift.** `lastActiveByRoadmap` copied in planner.js + insights.js;
  three hand-synced `stepLine`/`taskLine` variants; `dayKey`/`localDayKey` identical;
  two `daysUntil` with _different_ clamping. Extract shared `dates.js` + `project.js`.

### Client

- **C4. 409 conflict throws away the user's edit.** App.jsx:161–165 reloads and shows an
  error; the mutator is never re-applied, and the server's 409 already includes fresh
  state that the client ignores. Since `save()` takes a mutator, rebase-and-retry-once
  is cheap. With C2 unfixed, this is the _normal_ path for two-device use.
- **C5. `save()` reports failure after success.** App.jsx:152–165 wraps both the PUT and
  the follow-up refresh in one try — a refresh failure after a successful PUT shows
  "save failed", the modal stays open, retry creates a duplicate. Split the two.
- **C6. Enter-key double submit** (TaskModal.jsx:101, Roadmaps.jsx:465) — `submit()`
  guards on title but not `busy`; two quick Enters = duplicate items.
- **C7. `busy` disables all checkboxes** (Today.jsx:74), so completing the day's plan is
  tap-wait-tap-wait — defeating the optimistic-completion work. Remove the gate, but
  also make refreshes reconcile with pending optimistic flips (or only apply the last
  queued job's refresh) to avoid flicker.
- **C8. "One more" vanishes.** Today.jsx:186 requests an ephemeral bigger budget; the
  next `refreshDerived` (i.e. any completion) rebuilds the plan from settings and drops
  the extra item. Persist the day's budget override.
- **C9. Quick-add clears input before the write confirms** (Today.jsx:314) — a failed
  add loses the text. Clear on success / restore on failure.
- **C10. Error-path UX:** banner never clears on later successes (App.jsx:172–205);
  Onboarding renders before the banner exists so first-save failures are invisible
  (App.jsx:225); Settings reset has no try/catch; import file input never resets its
  `value`; raw "Failed to fetch" shown to the user.

### PWA / service worker

- **P1. A 502 gets cached as the app shell.** sw.js:33–36 `c.put("/index.html", res)`
  with no `res.ok` check (the asset path _does_ check). One error page during a server
  restart becomes the permanent offline shell.
- **P2. Nothing ever bumps `michi-shell-v1`** — old hashed assets accumulate forever,
  and non-hashed files (manifest, icons) are cached cache-first _permanently_, so icon/
  manifest changes never reach installed clients.
- **P3. Deploy-then-offline blank screen** — new index.html cached, its new hashed
  assets not yet fetched → offline shell references assets that exist nowhere.
  **Fix for all three:** either precache the built asset list on install with a
  build-hash cache name, or replace hand-rolled sw.js with `vite-plugin-pwa`.

---

## Low (worth a sweep)

Server: `?limit=-1` slices off the last suggestion (engine.js:170); `dailyGoal: 0`
coerced to 1 (engine.js:295); non-string `profile.name` 500s the digest (digest.js:29);
AI plan returns the draft's `counts` and ignores per-roadmap `stepMinutes`
(suggest.js:240,102); `" loose"` magic sentinel lane key (planner.js:213); SPA fallback
only registers if dist existed at boot; no `listen` error handler (port-collision crash
loop); `--experimental-sqlite` will fail to start when Node removes the flag.

Client: `useRef(createQueue(setBusy))` re-invoked every render (App.jsx:70); skip/replan
bypass the write queue; modal focus trap can target the hidden file input; iOS
standalone PWA `<a download>` for export is unreliable — test on-device (it's the only
phone-side backup path).

---

## Test gaps that matter

1. **Zero HTTP-level server tests.** The origin guard, 409 flow, error handler, and the
   import/export round-trip (where S1–S5 live) are untested. One `node:test` file
   booting the app on port 0 would have caught the top three server bugs.
2. **Zero client failure-path tests.** The smoke stub always returns ok — nothing
   exercises PUT→409, failed complete (C1), failed add (C9), or the save→refresh
   composition (C5).
3. `replaceCompletions` and plan-skips have no db tests; the "PUT never touches
   completions" invariant (db.js:552) — the one guarantee protecting streak history —
   is untested.
4. SW logic is only grepped for strings (pwa.test.mjs), never executed; the fetch
   handler is pure enough to unit-test with mocked `caches`/`fetch` (catches P1).
5. No day-rollover or double-submit tests.

---

## Ranked plan (impact ÷ effort)

1. **Validate settings/profile/completions + clamp numerics** (~20 lines) — kills S1,
   S2, and three lows; removes both ways one bad payload takes the app down.
2. **WAL-safe automatic backups** (Makefile + a systemd timer) — removes silent loss of
   the only backup path.
3. **Client resilience pass on App.jsx** (~40 lines): visibilitychange/online refetch +
   day-at-call-time (C2), guarded rollback (C1), split save/refresh errors (C5), clear
   error on success, onboarding errors (C10).
4. **Confirm-or-undo on deletes** — reuse the reset pattern (C3).
5. **Atomic import** (S4) + **HTTP integration test file** — the layer where all
   remaining server risk lives.
6. **SW fixes or vite-plugin-pwa** (P1–P3).
7. **Slim write responses / cap completions in getState** (S6/C6-twin) + extract shared
   date/projection modules (S8) in the same pass.
8. **Un-gate checkboxes with reconciling refresh** (C7) + rebase-on-409 (C4) — the big
   daily-feel wins for two-device phone use.

---

## Feature ideas (aligned with the vision)

Grouped by how directly they serve "one place that tells you what to work on today,
fully local, phone-first."

### Closes existing loops

- **Undo/trash.** A `deleted_at` soft-delete (or a small tombstone table) enables the
  undo toast in C3 and a Settings "Trash" view. Pairs naturally with the full-state PUT
  model.
- **Session logging.** You track _that_ a step was done, not _how long_. An optional
  "log 25m" on completion (default from estMin, editable) upgrades Momentum from
  streak-counting to real effort data — better pacing math ("you average 40m/day, this
  finish-by date needs 55m/day") and honest weekly reviews.
- **Evening close-out.** The digest covers the morning; a `?mode=evening` variant
  ("2 of 4 done, streak safe, tomorrow starts with X") gives the day a bookend and makes
  the "not today" pushes feel intentional. Same cron pattern.
- **Per-day budget override that sticks** (fixes C8 properly): "today I have 20 minutes"
  as a stored day-scoped setting the planner respects.

### Learning-coach depth

- **Spaced review.** You already log completions per step. Resurface finished steps as
  lightweight "recall: what was X about?" items n days later (1/7/30). This is the
  single most learning-science-native feature Michi could add, it's pure engine work
  (no new deps), and it fills planner slack on days when nothing is due.
- **Notes on steps.** A plain-text note per step (what you learned, links, gotchas)
  turns roadmaps into a record, not just a checklist — and gives the local model real
  context for smarter plans and weekly reviews.
- **Roadmap import from markdown/URL.** You already have a markdown parser for import;
  a "paste a roadmap.sh export / GitHub README" flow with the local model doing the
  milestone/step split would remove the biggest onboarding friction for new tracks.
- **Project↔roadmap links.** "This project applies that roadmap" — then the planner can
  alternate learn/build ("you finished the UART milestone; next session, wire it into
  the project"), which matches the stated philosophy that learning sticks when you build.

### Momentum & self-knowledge

- **Pace trend per roadmap.** You have targetDate math; show a small sparkline of
  %/week with "at this pace: done Sep 12" vs the finish-by date. Cheap, high-signal.
- **Weekly review → local-model reflection.** The review data exists; with MICHI_LLM on,
  a paragraph of "what actually happened this week and what to change" is a natural
  smarter-plan sibling.
- **Streak-freeze earn-back.** Freezes are static settings; earning one per 7-day streak
  makes them a mechanic instead of a config value.

### Ops / trust (fits the self-hosted identity)

- **Backup status surfaced in Settings** — last backup age, one-tap "back up now"
  (calls a `POST /api/backup` doing `VACUUM INTO`). Turns S3's fix into a visible
  feature.
- **Read-only week view / print sheet.** A `GET /week?format=html` printable plan is
  very in keeping with the local-first, no-cloud personality.

### Suggested sequencing

v0.8 = hardening (ranked plan items 1–5). v0.9 = session logging + budget override +
evening digest. v1.0 = spaced review + notes + project↔roadmap links. That order keeps
every release shippable and each feature builds on the previous one's data.
