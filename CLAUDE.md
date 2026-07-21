# CLAUDE.md — working guide for Michi

Guidance for an AI agent (or human) working in this repo. Read this first, then
`HANDOFF.md` for what's in flight right now.

## What Michi is

A single-user, self-hosted **personal learning coach**. You run the server on a
mini PC and reach it from your phone over **Tailscale** (no public ports); it
installs as a **PWA** ("Add to Home Screen"). It tracks long-running learning
**roadmaps** (→ milestones → steps), **projects** to ship, a daily **tasks**
layer, **kata** (daily self-regulation forms), a **journal / time log** of what
actually happened, a **Focus (Pomodoro) timer** whose blocks target the day's
tasks/steps and log to the journal (with opt-in Web Push when a block ends), and a
game layer (streak, XP/waypoints, discipline grades, heatmap). A local LLM (Ollama,
**on by default**) refines the day plan and suggests focus-block goals; the Claude
round-trip (export prompt → paste reply) handles structuring roadmaps/tasks.

Design north star (from the owner): **it must not feel like a chore.** Favor
one-tap/one-field interactions, calm copy, no nagging.

## Stack & layout

- **server/** — Express API + built-in `node:sqlite` (run with
  `--experimental-sqlite`). No DB server, no native deps.
  - `db.js` schema + all accessors + `validateState`/`importAll`/`getFullState`.
  - `engine.js` momentum (streak, XP, discipline, heatmap), `buildToday`.
  - `planner.js` deterministic day plan; `suggest.js` optional LLM refinement.
  - `markdown.js` the Claude **sync** round-trip (export prompt + parse/plan/apply).
  - `review.js` weekly review; `digest.js` morning/evening text; `insights.js`.
  - `focus.js` opt-in Web Push (VAPID + subscriptions in `meta`) for the Focus
    (Pomodoro) tab's end-of-block reminders, plus the local-model goal suggestion.
  - `index.js` all routes; `dates.js` local-day helpers; `backup.js`.
- **client/** — React 18 + Vite 8 + Tailwind 3 thin client (served by the server in prod).
  - `src/App.jsx` — tabs, global state, optimistic write queue, the FAB.
  - `src/views/*` — one file per screen/component.
  - `src/lib/*` — `api.js` (only place that calls the backend), pure helpers
    (`parse.js`, `quickadd.js`, `quicklog.js`, `intensity.js`, `format.js`, …).
  - `test/*.test.mjs` unit tests; `test/smoke.mjs` mounts the whole app in jsdom.
- **Makefile** — task runner. **samples/** — importable sample profile. **deploy/** — systemd units.

## Commands (run from repo root)

- `make dev` — server (:4001) + client (:5174), hot reload.
- `make build` — build client into `client/dist` (server serves it in prod).
- `make start` — build + serve everything on :4001.
- `make test` — server + client unit tests + the render smoke. **Always run before committing.**
  - or: `cd server && npm test`, `cd client && npm test`, `cd client && npm run test:smoke`.
- `make lint` / `npm run lint` — ESLint. `npm run format` — Prettier.
- `make sample` — regenerate `samples/sample-profile.json` (import via Settings).
- `make seed` — RESET the DB and load the sample profile (destructive).

**Definition of done for any change:** `make test` green **and** `npm run lint`
clean **and** `npx prettier --check` clean. The smoke test rebuilds the client
from source, so it catches render/runtime breakage a plain build won't.

## Environment

- `MICHI_DB` (default `server/data/michi.db`), `PORT` (4001), `HOST` (0.0.0.0).
- **The local model is ON by default** — only an explicit off value
  (`MICHI_LLM=0`/`false`/`off`/`no`) disables it. `MICHI_LLM_MODEL` (default
  `llama3.2:3b`), `MICHI_LLM_URL` (default `http://localhost:11434`, Ollama).
  Every model call falls back gracefully, so "on" with no Ollama running just
  takes the deterministic path; when explicitly off, AI features hide/no-op.

## Data model & invariants

- Entities: `roadmaps → milestones → steps`, `projects`, `tasks`, `kata`,
  plus history tables `completions`, `kata_days`, `journal`, and a `trash`
  safety net. `profile` + `settings` live in the `meta` table as JSON.
- **The everyday PUT (`/api/state`) carries the editable model only.** History
  (`completions`, `kataDays`, `journal`) is server-owned, **excluded from
  `getState()`/the PUT**, but **included in `getFullState()`** for export/import
  (backups). If you add a history table, wire it into `getFullState`,
  `importAll` (a `writeXRows`), `validateState`, and `resetAll`.
- **Streak/daily-goal count real work only** (tasks + steps). Kata and journal
  never inflate the streak/goal. Heatmap/XP count kata too. Weekly review counts
  tasks+steps only (kata excluded — see `review.js`).
- **Sync never deletes or archives.** `markdown.js` (the Claude round-trip) only
  creates/updates, and every synced change flows through
  `parseSync → planSync → preview → applySync` so the user approves a diff first.
- Writes are **optimistic** on the client and **serialized** through a queue
  (`lib/queue.js`) with optimistic-concurrency `rev` checks in `putState`.

## Conventions & gotchas

- **Colors: change values, not names.** `trail` (sage green) and `iris`
  (terracotta) are the two brand ramps; `slate` was re-tinted to a warm charcoal
  (dark mode is not blue). All defined by overriding those names in
  `client/tailwind.config.js` so component classes never churn. Keep it that way.
- **ESLint node globals target `server/**/\*.js`** (not `.mjs`). Server is ESM
(`"type":"module"`), so write server scripts as `.js`, not `.mjs`, or they'll
flag `process`/`console` as undefined.
- **Service worker cache** (`client/public/sw.js`): bump the `CACHE` constant
  whenever the app shell changes, or installed PWAs serve a stale shell.
- **Secure context:** clipboard + service worker need HTTPS. Over plain-HTTP
  Tailscale they degrade; front the server with `tailscale serve` for HTTPS.
  Server-side features (plan refinement, focus-goal suggestions) work over HTTP fine.
- **Dates are local days** (`YYYY-MM-DD`) via `server/dates.js` / `lib/format.js`
  `todayKey`. The journal calendar uses UTC-noon math purely for grid layout.
- Prefer the existing UI primitives in `client/src/ui.jsx` (`Card`, `Button`,
  `Modal`, `IconButton`, `Badge`, `Field`, `Input`…). `Input` forwards refs.
- No jsx-a11y plugin, but keep it accessible: every button/field needs a name
  (the smoke test asserts this).

## Releasing

SemVer, tagged (`vX.Y.Z`), with a `CHANGELOG.md` entry per version. Bump the
version in root + `client/` + `server/` package.json together. **Do not `git
push` unless explicitly asked** — the owner deploys manually.
