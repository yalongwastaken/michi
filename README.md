# Michi — personal learning coach

**v0.8.0** · self-hosted · single-user · no cloud · AI is optional & fully local

道 _michi_ — "the path." Where [Tsumiki](../tsumiki) coaches where your **money**
should go, Michi coaches where your **time and effort** should go. It turns your
scattered learning goals and roadmaps into one place that tells you what to work on
**today**, then tracks your momentum as you go.

It's a single-user app designed to run on the same mini PC as Tsumiki and be reached
privately from your phone or laptop over [Tailscale](https://tailscale.com) — no public
ports, no cloud, your data never leaves your own devices.

## The idea

You have more learning goals than you can hold in your head: roadmap.sh tracks, GitHub
roadmaps, courses, books, half-started repos. Michi gives them structure and a daily
front door.

- **Roadmaps** — a learning path broken into **milestones → steps**. Track % complete,
  set an optional **finish-by date** (Michi paces you to hit it), and reorder freely.
- **Today** — the home screen. A **planner** looks at the whole picture (what's due,
  what's in progress, deadlines, which roadmaps are neglected, your streak) and
  assembles a _doable day_ that fits a time budget you set. Push items to tomorrow
  ("not today"), ask for "one more," and add tasks in plain language ("read SPI 30m
  tomorrow"). Short **nudges** point out what needs attention.
- **Projects** — the meaningful things you want to build/ship, moved from idea →
  in progress → shipped (because learning sticks when you build).
- **Momentum** — a streak, a contribution-style heatmap, longest streak, active days,
  and per-roadmap progress. Streak **freezes** let you miss a day without losing it.

## Architecture

The **mini PC is the brain**: it runs the server, holds the SQLite database, and runs
the Today/momentum engine. Phones and laptops are thin web clients that talk to it over
the API.

```
server/   Express + node:sqlite API + the Today/momentum engine. No native deps.
client/   Vite + React single-page app (thin client, installable PWA).
deploy/   systemd units — michi.service (run 24/7) + a nightly backup timer.
```

Michi mirrors Tsumiki's spine on purpose (same stack, same self-hosted patterns) but is
a **separate app** with its own identity, data, port, and service. They share nothing
at runtime.

## Requirements

- **Node ≥ 22.12** and npm. The server uses the built-in `node:sqlite`
  (run with `--experimental-sqlite`); the client uses Vite 8. No database server or
  native build step required.

## Quick start

With [`make`](./Makefile):

```bash
make install   # install client + server dependencies
make dev       # run backend (:4001) and frontend (:5174) together
```

Then open http://localhost:5174 (the dev frontend proxies `/api` to the backend).

## Production (on the mini PC, alongside Tsumiki)

Build the client once; the server then serves it from `/`:

```bash
make start        # builds the client, then serves everything from :4001
```

Open `http://<mini-pc-ip>:4001`. Tsumiki stays on `:4000`; Michi takes `:4001`, so the
two run side by side on the same box without colliding. Configuration via environment:

| Variable   | Default                | Purpose                        |
| ---------- | ---------------------- | ------------------------------ |
| `PORT`     | `4001`                 | port to listen on              |
| `HOST`     | `0.0.0.0`              | bind address (LAN / Tailscale) |
| `MICHI_DB` | `server/data/michi.db` | SQLite database file path      |

Michi makes **no outbound network calls** — everything is local.

### Optional: a smarter planner with a local model

By default the planner is a fast, deterministic rules engine (no dependencies, no
model). If you want fuzzier judgment, point Michi at a **local** model and a "✨
Smarter plan" button appears on Today: it hands the model the full picture plus the
planner's draft and lets it re-pick the day, falling back to the deterministic plan on
any hiccup. Your data still never leaves the box — this is a `localhost` call to a
model you run.

```bash
# one-time: install Ollama on the mini PC and pull a small model
ollama pull llama3.2:3b

# then run Michi with the model layer enabled
MICHI_LLM=1 make start
```

| Variable          | Default                  | Purpose                              |
| ----------------- | ------------------------ | ------------------------------------ |
| `MICHI_LLM`       | _(off)_                  | set to `1` to enable the model layer |
| `MICHI_LLM_MODEL` | `llama3.2:3b`            | which local model to ask             |
| `MICHI_LLM_URL`   | `http://localhost:11434` | the local Ollama endpoint            |

Your whole dataset is only kilobytes, so it fits in any model's context window in full
— even a small 1–3B model sees everything at once. Bigger models just reason a bit
better; the deterministic planner is always the safety net.

## Optional: a morning digest

`GET /api/digest?format=text` returns a plain-text summary of the day (streak + the
planned items + one nudge). A cron job on the mini PC can pipe it to any local notifier
— no cloud, no outbound calls from Michi:

```cron
# 7am: post today's plan to an ntfy topic on your tailnet (or pipe to notify-send, etc.)
0 7 * * *  curl -s "http://localhost:4001/api/digest?format=text" | curl -s -d @- ntfy.local/michi
```

## Reach it from your phone (Tailscale) + install as an app

Same as Tsumiki: install Tailscale on the mini PC and your phone, then open
`http://<mini-pc-tailscale-ip>:4001` (or `http://minipc:4001` with MagicDNS). In Safari
/ Chrome, **Share → Add to Home Screen** to install the PWA — it launches fullscreen
with the Michi icon.

## Back up your data

`make backup` takes a **WAL-safe** snapshot of the database (SQLite's `VACUUM INTO`,
so it's complete and consistent even while the server is writing — a plain `cp`
would miss everything still in the WAL):

```bash
make backup       # → backups/michi-YYYY-MM-DD.db (keeps the 14 most recent)
```

Automate it nightly with the bundled systemd timer (02:00; `Persistent=true`, so a
run missed while the box was off happens at the next boot):

```bash
sudo cp deploy/michi-backup.service deploy/michi-backup.timer /etc/systemd/system/
sudo nano /etc/systemd/system/michi-backup.service   # set User + WorkingDirectory
sudo systemctl daemon-reload
sudo systemctl enable --now michi-backup.timer
```

Prefer cron? This works too:

```cron
0 2 * * *  cd ~/michi && make backup
```

## Testing

```bash
make test         # server engine/db tests + client lib tests
```

## Plan with Claude

Michi's state round-trips through Markdown so an AI assistant can help you plan
without any integration or API keys. In **Settings → Plan with Claude**: copy the
export (a snapshot of your roadmaps/projects/tasks with an embedded prompt), paste it
into Claude with whatever you want ("plan my next two weeks", "turn this book into a
roadmap"), then paste Claude's reply back. A preview shows exactly what would be
created and updated — per field, from → to — before anything is applied, atomically.
Items carry stable `{#id}` anchors so Claude edits in place; a sync can create and
update, but never delete.

## API

| Method | Path                | Purpose                                                                                  |
| ------ | ------------------- | ---------------------------------------------------------------------------------------- |
| GET    | `/api/health`       | liveness check                                                                           |
| GET    | `/api/state`        | the unified model (sans completion history — see `/api/export`)                          |
| PUT    | `/api/state`        | replace the full model (the client's "save")                                             |
| POST   | `/api/tasks`        | append a single task (lean write)                                                        |
| POST   | `/api/complete`     | toggle a task/step done (`{kind,id,done}`)                                               |
| GET    | `/api/today`        | the focused daily queue (`?day=`, `?limit=`)                                             |
| GET    | `/api/plan`         | a doable day from the planner (`?day=`, `?budget=`, `?ai=1`)                             |
| POST   | `/api/plan/skip`    | push a plan item to tomorrow (`{kind,id,day,on}`)                                        |
| GET    | `/api/momentum`     | streak, heatmap, roadmap/project progress (`?day=`)                                      |
| GET    | `/api/dashboard`    | today + momentum + plan + insights + weekly review, one round-trip (`?day=`, `?budget=`) |
| GET    | `/api/digest`       | plain-text (`?format=text`) or JSON summary of the day                                   |
| GET    | `/api/config`       | client capability probe (whether the local model is on)                                  |
| GET    | `/api/export`       | download the full model incl. completion history as JSON                                 |
| POST   | `/api/import`       | replace the model (and history) from an exported JSON                                    |
| GET    | `/api/export.md`    | Markdown snapshot with an embedded prompt — hand it to Claude to plan                    |
| POST   | `/api/sync/preview` | dry-run a pasted Markdown plan (`{markdown}`) — what would change                        |
| POST   | `/api/sync/apply`   | apply a Markdown plan atomically (create + update only, never delete)                    |
| POST   | `/api/reset`        | wipe everything and start fresh                                                          |

## License

All rights reserved. © 2026 Anthony. This is a personal project published for
reference; no license to use, copy, modify, or distribute is granted.
