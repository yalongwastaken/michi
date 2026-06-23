# Changelog

All notable changes to Michi are documented here. Versions follow
[SemVer](https://semver.org).

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
