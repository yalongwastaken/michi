# Changelog

All notable changes to Michi are documented here. Versions follow
[SemVer](https://semver.org).

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
