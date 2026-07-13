# Changelog

All notable changes to Michi are documented here. Versions follow
[SemVer](https://semver.org).

## [0.8.0] — 2026-07-13

### Added

- **Plan with Claude.** Export your whole state as Markdown with an embedded prompt
  (`GET /api/export.md`), hand it to Claude, and paste the reply back into Settings →
  "Plan with Claude". A preview shows exactly what would be created and updated
  (per-field, from → to) before an atomic apply. Sync can create and update roadmaps,
  milestones, steps, projects, and tasks — it can never delete. Items keep stable
  `{#id}` anchors so Claude can edit in place; new items get fresh ids. Syncs are
  idempotent: anchor-less items match existing ones by title (steps within their
  milestone), so pasting the same reply twice can't create duplicates.
- **A game layer.** Every completion earns distance on your path (task +10 m,
  step +25 m); levels are named waypoints (Trailhead → Summit, then round II). The
  Today header gains a daily-goal progress ring and a streak chip; Momentum gains a
  waypoint card and a streak-badge row (3–365 days, earned by longest streak ever).
  Confetti + a toast celebrate a met daily goal, a new waypoint, and new streak
  badges — each at most once, and never under reduced motion.
- **A mascot.** A small geometric shiba keeps you company: it celebrates when the
  goal is met, droops when the streak is at risk, and sits in the empty plan. The
  onboarding now explains the name: 道 michi — the path.
- **Error boundary.** A crash now shows a friendly recovery card with a reload
  button instead of a white screen.

### Changed

- Faster dashboards on long histories: streaks/heatmap/XP now read an incrementally
  maintained day-count cache instead of re-walking the whole completions log on
  every checkbox tap.
- The service worker is versioned (`michi-shell-v2`) and smarter: navigations are
  network-first (a 502 during a restart can no longer be cached as the permanent
  offline shell), hashed assets are cache-first, manifest/icons revalidate in the
  background, and old caches are deleted on activate.
- The app refetches when the PWA regains focus, visibility, or connectivity, and
  rolls over to the new day on its own overnight.
- Copy pass: nudges, digest, onboarding, and empty states now speak with one warm
  path-flavored voice; raw network failures read "can't reach the server" instead
  of "Failed to fetch".

### Fixed (from a whole-repo audit)

- Deleting a roadmap, step, project, or task now asks for a second tap to confirm.
- A 409 write conflict re-bases your edit on the fresh state and retries once
  instead of discarding it.
- A save that succeeds but whose follow-up refresh fails no longer reports "save
  failed" (which could cause duplicate retries) — it closes the modal and shows a
  soft banner.
- Double-Enter can no longer create duplicate tasks/roadmaps/projects; quick-add
  keeps your text when the add fails; the new-project modal no longer closes (and
  loses input) on a failed save and submits on Enter.
- Completion checkboxes stay tappable while other writes are queued.
- "One more" now sticks: the boosted budget survives later refreshes until the day
  changes.
- Settings: importing the same file twice works, import/reset errors use a proper
  banner instead of `alert()`, and first-save errors are visible during onboarding.

### Tests

- New: Markdown export/parse/plan/apply suite (23, including adversarial cases:
  attribute-like text inside titles, duplicate anchors, anchor-less headings matched
  by title, hostile input), sync HTTP integration cases, XP/waypoint/badge unit
  tests, activity-cache correctness tests (toggle on/off, import/reset
  invalidation). Server suite now 124 tests; client 33.
- The whole release was adversarially re-audited before shipping; the two worst
  findings (Markdown round-trips corrupting titles that contain attribute-like
  text; a failed completion toggle leaving a stuck optimistic checkmark) were
  fixed and regression-tested.

## [0.7.0] — 2026-06-23

### Added

- **Weekly review.** Momentum now has a "This week" card: what you finished, which
  roadmaps moved, and what slipped (overdue + past-due roadmaps), over the last 7 days.
- **Focus management.** Deleting a roadmap or project moves focus to the view heading
  instead of dropping it to `<body>`.

### Changed

- The write-queue moved into `lib/queue.js` and is covered by a concurrency stress
  test (50 jobs never overlap, busy toggles correctly, a failing job can't poison the
  chain). Contrast bumped on form hints, empty-state, and task metadata.

### Fixed (from a whole-repo audit)

- The optional model's "done today" check used a UTC date slice; now uses the local
  day like the rest of the server (no mis-filed evening completions west of UTC).
- `POST /api/plan/skip` and `/api/reset` now log + return clean errors like the other
  write routes. Dropped three unused client API wrappers.

### Tests

- New: weekly-review unit tests, write-queue concurrency stress test, a PWA
  installability test (manifest fields + real icon files + head tags + service worker),
  and the render smoke now asserts every control has an accessible name.

## [0.6.0] — 2026-06-23

### Added

- **Optimistic completion.** Checking a task/step on Today flips instantly, then
  reconciles with the server — no wait on a phone over Tailscale; failures roll back.
- **Morning digest.** `GET /api/digest?format=text` returns a plain-text summary
  (streak + plan + a nudge) for a local cron → notifier. Fully local, no cloud.
- **Accessibility pass.** Bottom tabs expose `aria-current`; the modal restores focus
  to its trigger on close; the heatmap has a text alternative (`role="img"`); the error
  banner is a live region; larger tap targets; inactive-tab contrast bumped; safe-area
  padding on the nav.

### Hardening (from a deeper audit)

- **Property-based fuzzing** of the planner (600 random states) — caught and fixed a
  real bug where a 0-minute estimate made `plannedMin` overcount the budget.
- **Parser fuzzing** (3000+ random/adversarial inputs) confirms the markdown and
  natural-language parsers never throw.
- The render smoke test now also asserts **every control has an accessible name**.

## [0.5.0] — 2026-06-23

### Added

- **Deadline-aware nudges.** Insights now flag roadmaps under time pressure —
  "Embedded: 3 days left, ~2/day to finish" or "past its finish date."
- **Render smoke test.** A headless harness (`make test-smoke`) mounts the real app
  in jsdom, walks every tab, opens Settings, and exercises quick-add — catching
  blank-screen/render regressions a build can't. `make test` now runs it too.

### Changed

- **Backups rotate.** `make backup` keeps the 14 most recent snapshots.

### Fixed (from an intensive audit)

- A malformed `?day=` no longer 500s `/api/dashboard` and `/api/momentum` — date
  params are validated at the route boundary, and `?budget=` is clamped to a sane
  range.
- The natural-language quick-add no longer throws on absurd input ("in 999999999
  days", a 100k-digit duration); date/number tokens are bounds-checked, and invalid
  calendar dates (e.g. `2024-02-30`) are rejected by the server.
- Plan refreshes are sequenced, so a slow "Smarter plan" can't clobber a newer plan
  (out-of-order responses are discarded).
- The planner and Today queue bucket steps once (O(n)) instead of re-scanning per
  roadmap — keeps planning fast with many large imported roadmaps.

## [0.4.0] — 2026-06-23

A smarter planner, less friction, and fewer round-trips — from an improvements audit.

### Added

- **Deadlines + pacing.** Roadmaps can have a "finish by" date; the planner schedules
  enough steps/day to land it in time (urgent deadlines first), tagged "deadline" on
  Today. Each roadmap can also set its typical **minutes per step** for accurate
  budgeting. Cards show "due {date} · ~N/day to finish."
- **Natural-language quick add.** Typing "read SPI docs 30m tomorrow" parses into a
  task with due date, estimate, and recurrence — deterministic, no model.
- **Interactive plan.** "Not today" pushes an item off (per-day, self-expiring),
  "one more" stretches the budget for an extra item.
- **Nudges.** Today surfaces short, data-driven prompts: overdue counts, a roadmap
  that's almost done, or one that's been neglected for a week+.

### Changed

- **One round-trip for Today.** A new `GET /api/dashboard` returns queue + momentum +
  plan + insights together, replacing three separate calls after every edit.
- **Touch fix.** The task-edit affordance is always visible (it was hover-only, so
  invisible on phones — the PWA's main device). Modals now trap focus (Tab).
- **DRY.** Recurrence logic is shared between the Today queue and the planner.

### Notes

- Deploy bucketing depends on the host timezone — the systemd unit now sets `TZ`.

## [0.3.0] — 2026-06-23

Michi starts deciding _for_ you. Today now leads with a planned day instead of a raw
list you have to triage yourself.

### Added

- **Day planner.** A holistic, deterministic engine builds a doable day from the whole
  picture: obligations first (overdue/due), then continuing what's already in progress,
  then rotating across roadmaps so neglected paths resurface — all fitted to a daily
  time budget, with streak protection so it never hands back an empty day. One-line
  rationale ("2 due + 3 steps across 3 roadmaps — ~75 of 90 min"). New `GET /api/plan`.
- **"Your day" on Today.** Leads the screen with the plan (each item tagged why), a
  quick time-budget control (30m/1h/1.5h/2h), and a collapsible "Browse everything" for
  the full buckets. Daily time budget is also a setting.
- **Optional local model (off by default).** Point Michi at a local Ollama model
  (`MICHI_LLM=1`) and a "✨ Smarter plan" button lets it re-pick the day from a
  validated menu, with the deterministic planner as a guaranteed fallback. Fully
  local — a `localhost` call, no cloud. New `GET /api/config`; `GET /api/plan?ai=1`.

### Changed

- The README tagline now reads "AI is optional & fully local" (the product still ships
  with no AI on by default).

## [0.2.0] — 2026-06-23

Feature work toward 1.0: import, richer tasks, and editing polish.

### Added

- **Roadmap import.** Paste Markdown (a roadmap.sh export, a GitHub roadmap README,
  course notes) and Michi parses it into milestones and steps — headings become
  milestones, list items become steps, `- [x]` marks done, and `[text](link)`
  attaches a resource. Live preview before import; runs entirely client-side, so the
  no-outbound-calls promise holds.
- **Richer task entry.** A full task editor (Today → the sliders button) with due
  date, recurrence (one-off / daily / weekdays / weekly), an effort estimate, and
  optional links to a roadmap step and/or a project. The same modal edits and deletes
  existing tasks (pencil on any task row).
- **Reorder.** Move milestones and steps up/down (touch-friendly), and tap a step's
  title to flag it "in progress."

### Changed

- **Serialized client writes.** All saves/completions run through a queue, so two
  quick edits can no longer race the optimistic-concurrency `rev` into a 409.

## [0.1.1] — 2026-06-23

Code audit fixes and a balanced two-color identity.

### Fixed

- **Recurring habits now build real streaks.** Activity is recorded in a new
  append-only `completions` log (one event per item per local day) instead of a
  single mutable `done_at` column, which previously got overwritten — so a daily
  habit completed every day used to show a streak of 1. Undo retracts only that
  day's credit; deleting a roadmap no longer erases the days you showed up. Backups
  now carry completion history through export/import.
- **Timezone-correct day bucketing.** Completions are bucketed by the user's local
  day (the mini PC's timezone), so an evening completion west of UTC no longer
  lands on the next day and silently breaks the streak/heatmap.
- **Streak freezes no longer over-counted.** Trailing gaps that run off the end of
  history don't consume freezes, so a brand-new 1-day streak correctly shows all
  freezes remaining.
- **`longestStreak` Map bug.** It now reads day keys via `.keys()` (a raw spread of
  the Map yielded `[key,value]` pairs).

### Changed

- **Two core colors, balanced.** Emerald _trail_ (green = activity & progress) now
  pairs with a complementary _iris_ violet (achievement & momentum). The logo climbs
  a green path to a violet summit, the header blends both, and streak/“in progress”
  accents are violet. Replaces the former amber accent.

## [0.1.0] — 2026-06-23

Initial release. A self-hosted, single-user learning coach that runs alongside Tsumiki
on the mini PC (port 4001).

### Added

- **Server** — Express + `node:sqlite` backend (no native deps). Unified data model
  (roadmaps → milestones → steps, projects, tasks, profile/settings) with a full-state
  `PUT` guarded by an optimistic-concurrency `rev`, lean `POST /api/tasks` and
  `POST /api/complete` write paths, export/import/reset, and a CSRF/DNS-rebinding origin
  guard. Serves the built client.
- **Today engine** — a focused daily queue: overdue + due-today tasks (with `daily` /
  `weekdays` / `weekly` recurrence) plus the next not-done step of each active roadmap.
- **Momentum engine** — streaks with configurable freezes, longest streak, active-day
  count, a contribution-style heatmap, and per-roadmap progress.
- **Client** — Vite + React thin client with its own "trail" identity (emerald palette,
  winding-path mark). Views: Today, Roadmaps, Projects, Momentum, Settings, and a
  first-run onboarding. Installable PWA with offline app-shell caching.
- **Ops** — `make` targets mirroring Tsumiki, a `deploy/michi.service` systemd unit, and
  one-file SQLite backups.
- **Tests** — server engine + db unit tests (21) and client lib tests; full end-to-end
  API smoke verified.
