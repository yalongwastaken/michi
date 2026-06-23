# Michi — running it alongside Tsumiki & installing on your phone

A plain-English guide to running Michi on the same mini PC as Tsumiki, installing it on
your iPhone, and keeping it running. (For the feature overview, see
[`README.md`](./README.md).)

> **The model in one line:** the mini PC runs everything and holds your data; your phone
> is just a thin client that reaches it privately over Tailscale. Tsumiki is `:4000`,
> Michi is `:4001`.

---

## 1. One-time setup (on the mini PC)

**Prerequisites:** [Node.js](https://nodejs.org) **22.12 or newer** and npm — the same
runtime Tsumiki already uses, so you likely have it. Check with:

```bash
node --version    # should print v22.12.x or higher
```

Get the code onto the mini PC (clone your repo, or copy the `michi/` folder next to
`tsumiki/`), then:

```bash
cd michi
make install      # installs dependencies for the root tooling, client, and server
```

Nothing to compile, no database to configure — the SQLite file is created automatically
on first run, separate from Tsumiki's.

---

## 2. Run it

### The simple way (build once, then serve everything)

```bash
make start        # builds the web app and serves it on :4001
```

Open `http://localhost:4001` on the mini PC to confirm it works. Tsumiki keeps running
on `:4000` — the two don't interfere.

### Keep it running 24/7 (recommended)

A ready-made systemd unit lives in [`deploy/michi.service`](./deploy/michi.service).
Copy it into place, fixing the `WorkingDirectory` and user to match where you put the
repo:

```bash
sudo cp deploy/michi.service /etc/systemd/system/michi.service
sudo nano /etc/systemd/system/michi.service     # set WorkingDirectory, User, and TZ
sudo systemctl daemon-reload
sudo systemctl enable --now michi.service
sudo systemctl status michi.service
```

It now starts on boot and restarts on failure — exactly like your Tsumiki service, just
on port 4001. You'll have two units side by side: `tsumiki.service` and `michi.service`.

---

## 3. Install it on your iPhone

1. Make sure Tailscale is running on both the mini PC and your phone (same tailnet) —
   the same setup you use for Tsumiki.
2. On the phone, open `http://<mini-pc-tailscale-ip>:4001` (or `http://minipc:4001` if
   you enabled MagicDNS).
3. In **Safari**: **Share → Add to Home Screen**. It installs with the Michi trail icon
   and launches fullscreen.

---

## 4. First run

On first open, Michi asks your name and offers to start with an example roadmap (a
bare-metal embedded path) or from scratch. Everything it seeds is fully editable — add
your real roadmaps under the **Roadmaps** tab, capture builds under **Projects**, and
check things off from **Today**.

---

## 5. Back up & update

- **Backup:** `make backup` copies the database to `backups/michi-YYYY-MM-DD.db`. Add a
  nightly cron line (`0 2 * * * cd ~/michi && make backup`) the same way you did for
  Tsumiki.
- **Update:** pull the latest code, then `make install && sudo systemctl restart michi`.
- **Export anytime:** Settings → Export downloads the whole dataset as JSON; Import
  restores it.
