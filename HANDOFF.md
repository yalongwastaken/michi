# HANDOFF — Michi (as of the journal work)

Context for the next agent picking this up. Pair with `CLAUDE.md` (architecture,
commands, conventions). Written after a session that shipped a UI overhaul, a
local-LLM drafting feature, and a daily journal.

## Where things stand

- Branch tip: **`11fa618`**, working tree **clean**. Six commits sit **on top of
  the `v1.4.0` tag** and are **not yet released or pushed** (the owner pushes +
  deploys manually — do not `git push` unless asked).
- Tests: **server 226 / client 57 / smoke 15 — all green**; lint + prettier clean.
- Everything is committed. The post-`v1.4.0` commits should become **`v1.4.1`**
  (or a minor, given the journal is a real feature) whenever the owner is ready —
  bump the three package.json versions + add a `CHANGELOG.md` entry then.

### Commits since v1.4.0 (newest first)

- `11fa618` daily journal / time log (new Journal tab, quick-log, `/api/journal`)
- `ca67238` local-model auto-draft roadmaps/tasks from pasted content (`/api/ai/draft`)
- `e9677f6` low-friction add/complete (FAB quick-add, big tap target, swipe-to-complete)
- `a864fd9` sample profile generator + `make sample` / `make seed`
- `b5a1591` fix: weekly review counts work only, not kata honors
- `c4fe464` **v1.4.0** — Home/Progression tabs, intensity goals, conversational Claude export, recolor

## The owner's product vision (target shape)

Michi should be a full loop, none of it feeling like a chore:

1. **Weekly** — plan the week's bigger goals. _(not built — see below)_
2. **Daily** — plan what to achieve today. _(exists: Today tab + planner)_
3. **Overarching goals** — long-term goals above roadmaps/projects. _(not built)_
4. **Projects** — track and help finish them. _(exists; could go deeper)_
5. **Daily journal / time log** — log what you did, calendar day-view. _(SHIPPED this session)_

The owner will keep a local LLM (Ollama) running by default — lean on it in new
features (drafting, summarizing, parsing), always with a deterministic fallback
and human approval before writes.

## Must-fix / rough edges in what shipped

Highest-value polish before this is truly airtight. None are crashes or data
risks; all are contained.

1. **Journal timeline: overlapping entries overlap visually.**
   `client/src/views/Journal.jsx` → `Timeline`/`TimedBlock` absolutely position
   blocks by start/end but do **no collision handling**. Two entries sharing a
   window render on top of each other. Add Google-Calendar-style **column
   layout** (group overlapping entries, split width into N columns). Acceptance:
   two overlapping timed entries render side-by-side and both are readable.
2. **No time editing for a journal entry.** You can add and delete, not edit.
   `PATCH /api/journal/:id` and `db.updateJournalEntry` already exist — wire a
   tap-to-edit (title + start/end) on `TimedBlock` and the untimed rows.
3. **Nothing is visually verified in a real browser.** The recolor, dark mode
   (warm charcoal), the 5-tab nav, the Journal calendar/timeline, the swipe, and
   the intensity picker have only been checked via jsdom (DOM, not pixels). Do a
   pass in light **and** dark on a phone-width viewport. Especially: journal
   block contrast in dark mode, timeline on a busy day.
4. **Swipe-to-complete is untested by the smoke run** (jsdom has no touch).
   `client/src/views/SwipeRow.jsx` — verify on a real touch device: short swipe
   opens edit, full swipe completes, vertical scroll still works, no fight with
   iOS edge-back.

## Pending housekeeping (small, previously flagged, not yet done)

- **Bump the SW cache** `CACHE` in `client/public/sw.js` (`michi-shell-v3` →
  `v4`) — the shell was recolored; installed PWAs need the bump to refresh.
- **INSTRUCTIONS.md** — add a short "HTTPS via `tailscale serve`" note under the
  iPhone section: clipboard ("Copy prompt for Claude") and the installable PWA
  need a secure context, which plain-HTTP Tailscale isn't.
- **README/INSTRUCTIONS** — document the new bits: the Journal tab, the FAB
  quick-add/log, and the `MICHI_LLM` "Draft from notes" feature (`/api/ai/draft`).
- Consider seeding a few `journal` rows in `server/scripts/seed-sample.js` so the
  sample profile's calendar isn't empty (nice for demos/testing).

## Next features (the deferred half of the vision)

Build in this order; both should **roll up the journal's time data**.

### A. Overarching goals + weekly focus (the top-down layer)

Design already discussed with the owner:

- **Goals**: a small top-level entity, **laddered** — roadmaps/projects/weekly
  focus can link up to a goal; the goal shows rolled-up progress. Give it an
  optional horizon (quarter/year). Keep creation frictionless.
- **Weekly focus**: a per-week set of written intentions (distinct from the
  numeric `weeklyGoal` target that already exists in settings), ideally linkable
  to a goal/project/roadmap. A light weekly "set your focus" moment, reviewed
  against the daily plan and the week's logged hours.
- **Placement**: nav is already at 5 tabs (Home/Today/Plan/Journal/Progress).
  Don't add a 6th. Fold **Goals into the Plan tab** (it's a segmented
  Roadmaps/Projects view today — add Goals), and put **weekly focus on Home**
  (which already has the streak + "This week" card). Confirm with the owner.
- **Data**: a `goals` table (id, title, horizon, note, archived, position,
  created_at) + a nullable `goal_id` soft-link on roadmaps/projects; a
  `weekly_focus` table keyed by ISO week (or a `meta` blob per week). Follow the
  history-table wiring rules in `CLAUDE.md` if any of it is server-owned history.
- **LLM assist**: "draft this week's focus from my goals + what I logged/finished
  last week" via the existing `draft.js` pattern; deterministic-safe, previewed.

### B. Deepen project help

The planner already surfaces project-linked tasks. Consider: per-project logged
hours (from the journal), a "what's next on this project" nudge, stale-project
detection.

## How to verify anything you change

```
make test          # server + client unit + smoke — must be green
npm run lint       # must be clean
npx prettier --check "server/**/*.js" "client/src/**/*.{js,jsx}" "client/test/**/*.mjs"
```

For visual work, run `make dev` and check light + dark at phone width. If you add
a nav tab or rename one, update the tab loop and `navTo` targets in
`client/test/smoke.mjs` (it currently walks `Home/Today/Plan/Journal/Progress`
and drives the Plan sub-toggle + discipline card on `Progress`).

## Landmines (learned this session)

- ESLint node globals only apply to `server/**/*.js`; server is ESM, so name
  server scripts `.js` (a `.mjs` will flag `process`/`console`).
- `review.js` deliberately excludes `kind === "kata"` completions — don't
  "fix" it back.
- Keep the color system as **value overrides** of `trail`/`iris`/`slate` in
  `tailwind.config.js`; don't scatter new hex or rename tokens.
- Small local models are unreliable at strict grammar — that's why AI output is
  always previewed + editable before apply, and drafting targets the simple
  create-grammar. Keep that human-in-the-loop.
