# Changelog

All notable changes to Michi are documented here. Versions follow
[SemVer](https://semver.org).

## [1.5.0] — 2026-07-22

Two new layers above the daily plan: a **weekly schedule** you can draft with
Claude, and **overarching goals** that turn finished work into visible progress.

### Added

- **Overarching goals** (Progress tab). Set a long-horizon aspiration — "climb
  V10", "reach Japanese N1" — then attribute finished **tasks _and_ roadmap
  steps** to it. Each goal shows a running progress feed (completions, active
  days, a contribution strip) built from your history, so attribution is
  retroactive: linking an item credits its whole past. Mark a goal **achieved**
  for a small celebration.
- **Week plans** (Plan → **Week**). The overarching weekly layer: one card per
  focus area with a one-line theme, a Monday→Sunday **day split**, and a weekly
  **targets** checklist. Browse week to week, with **copy last week** so a
  repeating rhythm carries forward in one tap.
- **Plan the week with Claude.** A dedicated copy-prompt → paste → preview →
  apply round-trip (separate from the item sync) that drafts a whole week from
  your goals and roadmaps; applying replaces that week's plan.
- **"This week" on Today.** Today's slice of each area's day split, with a
  one-tap **Refine** that breaks a day's focus into concrete tasks via the local
  model (graceful fallback when it's off), attributed to the area's goal.
- **Attribute work to a goal** from the goal card ("Add work" pulls in finished
  tasks/steps) or the task editor's new "Toward a goal" field.

## [1.4.0] — 2026-07-14

A new shape for the path. Momentum becomes home, the day gets a coach, and the
whole app trades its blue-and-orange for the colors of a trail.

### Added

- **Home tab.** The repurposed momentum view is now the landing screen: the
  streak, a new **Today at a glance** section (goal progress, what's still
  planned, a jump into the day), the week in review, headline stats, and the
  activity heatmap.
- **Progression tab.** A dedicated home for the journey — waypoint/level,
  the discipline (kyū/dan) grade, streak badges, and roadmap progress.
- **Intensity.** Instead of setting raw numbers, pick how hard you're pushing —
  **Easy · Steady · Focused · Intense** — and each preset sets your daily goal,
  time budget, and weekly goals for you. A collapsible **Customize** still
  exposes every exact number (and marks the preset "custom" when you do).
- **Weekly goals.** Alongside the daily goal, a weekly completion target and an
  active-days-per-week target, shown with progress on Home's "This week" card.
- **Plan today with Claude, on the day.** The export/sync flow is surfaced as a
  card on Today (auto-opens on your first visit each day), not just tucked in
  Settings.

### Changed

- **Navigation.** The bottom bar is now **Home · Today · Plan · Progression**.
  Roadmaps and Projects are consolidated behind one **Plan** tab with a
  segmented toggle.
- **Color scheme.** Sage green (progress, heatmap) and terracotta (streaks,
  badges) replace the old indigo-and-persimmon; the companion's scarf follows.
  Dark mode is now a warm charcoal instead of blue-tinted slate.
- **The Claude export is a conversation.** The prompt now opens a coaching chat:
  Claude plans from your roadmaps and tasks _and_ helps with ad-hoc goals that
  aren't tracked in the app, folding anything worth keeping into saveable tasks.
  The paste-back sync round-trip is unchanged — nothing is ever deleted by it.

## [1.3.0] — 2026-07-13

型 kata — daily forms. Roadmaps are where you're going; kata are how you walk.

### Added

- **Kata (型).** Small self-regulation practices — greyscale phone, no feeds
  before noon, shutdown ritual — that you commit to (at most 5 active) and log
  daily from a chip strip on Today. Each honored kata earns +5 m on the path;
  honoring all of them makes a **clean day** (+15 m). Kata count toward the
  heatmap and XP but never inflate the main streak or daily goal — showing up
  and doing the work stay separate ledgers.
- **The dōjō (道場).** A training-hall sheet: your active kata, a 12-form
  built-in library, custom forms of your own, and suggestions michi derives
  from your actual data ("3 completions after 21:00 this week — close the day
  on purpose"). Kata honors are excluded from the evidence, so the forms can't
  recommend themselves.
- **Discipline grades (級/段).** Clean days climb a real grading ladder — 10級
  to 1級, then 初段 shodan through 十段 jūdan ("the path continues") — shown on
  Momentum with a grade ring, clean-day streak, and a 7-day dot row. Grade-ups
  celebrate quietly: the indigo locked-in aura, no confetti. Japanese terms
  ship with romaji and translation throughout, marked `lang="ja"` for screen
  readers.
- **Everywhere else:** morning digest lists today's kata; the evening digest
  names what's still open ("shutdown ritual still open") or declares 型 held;
  the Claude sync grammar gains a `## Kata` section (checkbox = active,
  honoring stays in-app); deleted kata rest in the trash like everything else.

### Fixed (pre-release audit)

- Retiring a kata mid-day re-reconciles today's snapshot, so a clean day can
  never become unreachable; un-honoring everything resets the day fresh.
- The honor endpoint rejects future days (no pre-earning grades) and
  non-boolean flags; the clean-day celebration is judged from server truth,
  not the optimistic UI; sync previews now warn when a plan would exceed the
  5-active cap instead of failing only at apply.

### Tests

- Server 219 (+41), client 48 (+3): snapshot reconciliation, grade-ladder
  edges, streak/XP invariants, MD round-trips, suggestion evidence rules,
  future-day rejection, celebration dedupe seams.

## [1.2.0] — 2026-07-13

The companion update: michi stops being an app with a mascot and becomes a
path you walk with one.

### Added

- **Nine companions, your pick.** Shiba, red panda, daruma, kitsune, tanuki,
  raccoon, maneki-neko, moon rabbit, and crane chick — one shared, hand-tuned
  construction (single connected silhouette, one light source, blended legs)
  so the whole cast reads as a family. Choose yours during onboarding or in
  Settings → Companion; every render in the app follows your choice.
- **A living companion.** Idle breathing and blinks; a hop when you check
  something off; a full celebration on the daily goal; sleepy when the streak
  is at risk; a golden aura when you reach a waypoint; a flame aura on a 7+
  day streak; an indigo "locked in" pulse when you clear three items inside
  an hour. All states honor reduced-motion.
- **Coach bubbles.** The companion now speaks the app's most important line:
  the top nudge on Today, the streak verdict and weekly reflection on
  Momentum, a greeting in onboarding, a warning at the danger zone.
- **The daruma ritual.** Dated roadmaps carry a small one-eyed daruma; finish
  the roadmap and it earns its second eye — once, ever, with ceremony. Only
  transitions you actually walk count: imports and syncs of already-finished
  roadmaps stay silent.
- **The winding path.** Roadmaps can render as an actual path — steps as
  nodes on a snaking trail climbing the screen, milestones as torii gates,
  the walked segment painted persimmon, and your companion standing on the
  frontier node (or celebrating at the summit when it's done). Toggle
  path/list per device; editing stays in list view.

### Fixed (pre-release audit)

- A rituals-first ledger seed could refire every historical streak badge;
  celebration and ritual dedupe now each gate on their own fields.
- 100% now means every step done — a 199/200 roadmap no longer opens the
  daruma's eye early (and can no longer mute the real completion).
- Companion picker save failures surface in the Settings banner instead of
  vanishing behind the modal; locked-in mode no longer counts failed or
  re-toggled completions and expires on its own; path-view labels can't slip
  under the frontier node; path nodes meet 44px tap targets; simultaneous
  toasts stack instead of overlapping.

### Tests

- Server 178, client 45 (+ celebrate/ritual regressions, exact-completeness,
  path-view smoke + a11y coverage). Bundle: +10 KB gzip for the entire cast.

## [1.1.0] — 2026-07-13

The repaint: Michi trades emerald-and-violet for a persimmon + indigo pairing
that flatters the shiba, and the shiba himself got a proper rebuild.

### Changed

- **New palette: persimmon + indigo.** The `trail` scale is now warm persimmon
  (#F25C05/#E04E00 core) and `iris` is a muted indigo (#5B67B7/#4F5D9E core) —
  token names kept so component classes didn't churn. Text shades audited to
  ~4.5:1 contrast on their actual backgrounds in light and dark mode.
- **Gradients removed.** The radial `trail-gradient` wash (header, plan card,
  streak card, onboarding) is gone — the header is plain warm paper with a
  hairline border, and the plan/streak cards wear a calm solid persimmon tint.
  The progress ring and waypoint bar are solid fills now too, and the confetti
  matches the new palette.
- **Logo + favicon recolored:** cream tile, persimmon path, indigo summit flag;
  the PWA icons (192/512/maskable/apple-touch) were regenerated to match, and
  the manifest/theme colors follow suit.
- **Mascot rebuilt.** Michi the shiba is redrawn sticker-flat on a clean 96×96
  grid: bold symmetric shapes, no outlines, one shade tone (inner ears, tail
  underside), cream markings, and a persimmon collar. Same moods, same API.
- Service worker cache bumped to `michi-shell-v3` so installed apps pick up the
  recolored shell and icons on next visit.

## [1.0.0] — 2026-07-13

Michi 1.0: the workflow is complete (0.9's trash/undo, backlog, notes, links)
and this release makes the tool trustworthy enough to stop thinking about —
backups you can see, a day that closes as well as it opens, and a review that
reflects instead of counts. Adversarially audited end to end.

### Added

- **Backups in the app.** Settings shows your backup health — last backup age,
  size, how many are kept — with a "Back up now" button (WAL-safe `VACUUM INTO`,
  same snapshots the nightly timer takes). `GET /api/backups`, `POST /api/backup`.
- **Evening digest.** `GET /api/digest?mode=evening` closes the day: what you
  finished (+meters on the path), whether the streak is safe, and up to three
  things for tomorrow. Pipe it to a notifier at 21:30 next to the 7am one.
- **A weekly review that reflects.** The "This week" card now offers one true
  sentence about the week's shape — the big day, the path most walked, or the
  pace against last week (kindly, when it's down).

### Fixed (final pre-1.0 audit)

- **Per-step deletes now rest in the trash too** — the one delete that
  bypassed the safety net. Steps restore into their milestone, or 409 with
  a pointer to restore the whole roadmap.
- **Undo is now a true undo:** restores re-attach the links the delete had to
  sever (project→roadmap, task→step/project) when you haven't repointed them,
  and the undo toast is driven by an exact receipt in the save response
  (`trashed: [...]`) instead of guessing — two same-titled deletes can no
  longer restore the wrong one. Multi-item deletes undo as a batch.
- The undo toast renders above open sheets; trash operations ride the write
  queue; trash keeps 200 rows so a mass delete can't evict the prior safety
  net; backup listing ignores imposter directories; a project summary starting
  with "> " round-trips through the Claude sync.

### Tests

- Server 177 (+12), client 41. Every audit finding shipped with a regression
  test.

## [0.9.0] — 2026-07-13

### Added

- **Trash & undo.** Deleting a roadmap (with its whole subtree), project, or task
  is no longer fatal: the server snapshots it into a trash (30 days, newest 50),
  a toast offers one-tap Undo, and Settings gains a Trash section with restore /
  delete-forever / empty. Restores that collide with recreated ids remap to fresh
  ones; JSON import and Claude sync never auto-trash (they're replace semantics).
- **Backlog.** "All tasks" from Today: every task in one sheet — filter chips
  (overdue / today / upcoming / undated / done), overdue-first sorting, optimistic
  checkboxes, Today/+1d/+1w quick reschedule, tap to edit.
- **Notes on steps and tasks.** A notes field in the task editor and a note glyph
  on step/plan rows (tap to read, edit in place). Notes travel through the Claude
  sync as `> blockquote` lines, so Claude can annotate your plan and you can
  annotate back.
- **Projects ↔ roadmaps.** Projects can link to the roadmap they exercise; the
  card shows the roadmap's progress and jumps to it. Projects are reorderable
  like everything else.
- **Freeze earn-back.** Waypoints 4 and 8 each grant a bonus streak freeze
  (capped at +2), on top of the freezes you set — the game layer now protects
  the streak it celebrates.

### Fixed

- Deleting a roadmap or project left tasks/projects pointing at ghosts
  (`task.stepId`, `task.projectId`, `project.roadmapId`); delete mutators now
  null every inbound reference (centralized in `lib/mutate.js`). Server-side, a
  write carrying a dangling `task.stepId`/`task.projectId` is rejected with a
  400 naming the ghost; only a dangling `project.roadmapId` is self-healed
  (nulled) on write.

### Tests

- Server 148 (+24: trash diff/restore/remap/retention, project links, notes
  grammar round-trips, earn-back); client 40 (+7: delete mutators, date helpers,
  backlog/trash smoke coverage).

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
