import { useEffect, useRef, useState } from "react";
import {
  Download,
  Upload,
  Trash2,
  Sun,
  Moon,
  Monitor,
  Sparkles,
  Check,
  Map,
  Hammer,
  CheckCircle2,
  Undo2,
  Archive,
  Footprints,
  Shell,
  ChevronDown,
  ChevronRight,
  Bell,
} from "lucide-react";
import { Modal, Button, ConfirmButton, Field, Input, Select, Badge } from "../ui.jsx";
import { api } from "../lib/api.js";
import { timeAgo, formatBytes } from "../lib/format.js";
import { INTENSITY_LEVELS, intensityPatch, matchIntensity } from "../lib/intensity.js";
import Mascot, { SPECIES_LIST } from "./Mascot.jsx";
import CoachBubble from "./CoachBubble.jsx";
import PlanWithClaude from "./PlanWithClaude.jsx";

// glyphs for what kind of thing is resting in the trash (Footprints matches the
// step glyph on Today's plan rows; Shell — a quiet spiral — stands for a kata form)
const TRASH_ICON = {
  roadmap: Map,
  step: Footprints,
  project: Hammer,
  task: CheckCircle2,
  kata: Shell,
};

const THEMES = [
  { id: "system", label: "System", icon: Monitor },
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
];

// notifications need a secure origin + the installed service worker + Push support
const pushSupported = () =>
  typeof window !== "undefined" &&
  window.isSecureContext &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;

// base64url VAPID key → the Uint8Array applicationServerKey the browser wants
function b64ToU8(base64) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

// Settings section: enable/disable Focus-block push reminders for THIS device.
// Mirrors tsumiki's opt-in — permission → subscribe → the server pushes when a
// running focus block ends (see server/focus.js).
function NotificationsSection() {
  const [status, setStatus] = useState("loading"); // loading|unsupported|off|on|busy
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      if (!pushSupported()) {
        setStatus("unsupported");
        return;
      }
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = await reg?.pushManager?.getSubscription();
        setStatus(sub ? "on" : "off");
      } catch {
        setStatus("off");
      }
    })();
  }, []);

  async function enable() {
    setStatus("busy");
    setErr("");
    try {
      if ((await Notification.requestPermission()) !== "granted") {
        throw new Error("Notifications were blocked — allow them in your browser settings.");
      }
      // getRegistration (not .ready): .ready never resolves with no SW registered
      // (dev mode / a failed registration) and would hang this button forever
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) {
        throw new Error("No service worker here — use the installed app (production build).");
      }
      const { key } = await api.push.key();
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: b64ToU8(key),
      });
      try {
        await api.push.subscribe(sub.toJSON());
      } catch (e) {
        // the browser subscribed but the server didn't store it — roll back so the
        // device doesn't show "On" while no push will ever arrive
        await sub.unsubscribe().catch(() => {});
        throw e;
      }
      setStatus("on");
    } catch (e) {
      setErr(String(e.message || e));
      setStatus("off");
    }
  }

  async function disable() {
    setStatus("busy");
    setErr("");
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager?.getSubscription();
      if (sub) {
        await api.push.unsubscribe(sub.endpoint);
        await sub.unsubscribe();
      }
      setStatus("off");
    } catch (e) {
      setErr(String(e.message || e));
      setStatus("on");
    }
  }

  return (
    <div className="border-t border-slate-200 pt-4 dark:border-slate-700">
      <p className="mb-1 flex items-center gap-1.5 text-sm font-medium text-slate-600 dark:text-slate-300">
        <Bell size={15} className="text-iris-500 dark:text-iris-300" /> Notifications
      </p>
      <p className="mb-3 text-xs text-slate-400">
        A push when a Focus block or break ends — even with the app in the background. Per device.
      </p>
      {status === "unsupported" ? (
        <p className="text-xs text-slate-400">
          Not available here — notifications need a secure address (your Tailscale HTTPS name or{" "}
          <span className="font-mono">localhost</span>) and the installed app (PWA).
        </p>
      ) : (
        <Button
          variant={status === "on" ? "ghost" : "primary"}
          onClick={status === "on" ? disable : enable}
          disabled={status === "loading" || status === "busy"}
          className="w-full"
        >
          {status === "busy" || status === "loading"
            ? "…"
            : status === "on"
              ? "Turn off on this device"
              : "Enable notifications on this device"}
        </Button>
      )}
      {status === "on" ? (
        <p className="mt-2 text-xs text-trail-700 dark:text-trail-400">On for this device.</p>
      ) : null}
      {err ? (
        <p role="alert" className="mt-2 text-xs text-rose-600 dark:text-rose-400">
          {err}
        </p>
      ) : null}
    </div>
  );
}

export default function Settings({ ctx, onClose }) {
  const { state, save, refresh, busy, trashRestore, trashPurge, trashEmpty } = ctx;
  const fileRef = useRef(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [name, setName] = useState(state.profile?.name || "");
  const [error, setError] = useState(null); // import/reset problems, shown in the modal

  const settings = state.settings || {};

  const setSetting = (patch) => save((s) => Object.assign(s.settings, patch));
  // editing a raw goal number breaks out of a preset — the picker shows "custom"
  const setCustom = (patch) => setSetting({ ...patch, intensity: "custom" });
  const intensity = matchIntensity(settings);
  const [showAdvanced, setShowAdvanced] = useState(intensity === "custom");

  // the companion picker saves from behind this modal — App's banner is invisible
  // under the overlay, so a failed save has to surface in the in-modal one
  const pickCompanion = async (id) => {
    const ok = await save((s) => (s.profile.mascot = id));
    if (ok) {
      setError(null);
    } else {
      setError("couldn't save your companion — try again");
    }
  };

  // the trash list — fetched once when Settings opens (this component only
  // mounts on open, so the effect *is* the lazy load). null = still loading.
  const [trash, setTrash] = useState(null);
  const trashBusy = useRef(false); // one restore/purge at a time
  // the backups list rides the same lazy load. null = still loading.
  const [backups, setBackups] = useState(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backedUp, setBackedUp] = useState(false); // brief "Backed up ✓" flash
  const backupFlash = useRef(null);
  // a ref, not just state: two taps in the same render both read backupBusy as
  // false before React flushes — same double-tap pattern as `syncing` above
  const backingUp = useRef(false);
  useEffect(() => {
    api
      .trash()
      .then((r) => setTrash(r.items || []))
      .catch(() => setTrash([])); // unreachable → show the calm empty state
    api
      .backups()
      .then((r) => setBackups(r.items || []))
      .catch(() => setBackups([]));
    return () => clearTimeout(backupFlash.current);
  }, []);

  const backupNow = async () => {
    if (backingUp.current) {
      return;
    }
    backingUp.current = true;
    setBackupBusy(true); // state still drives the disabled/label UI
    try {
      await api.backupNow();
      // refetch rather than splice — rotation may also have dropped the oldest
      setBackups((await api.backups()).items || []);
      setBackedUp(true);
      clearTimeout(backupFlash.current);
      backupFlash.current = setTimeout(() => setBackedUp(false), 2000);
      setError(null);
    } catch (err) {
      setError(err.message || "backup failed");
    }
    backingUp.current = false;
    setBackupBusy(false);
  };

  // restore/purge/empty go through the ctx helpers, which ride App's write
  // queue — a restore adopting state outside the queue could transiently
  // regress it while a save was still in flight
  const restoreItem = async (row) => {
    if (trashBusy.current) {
      return;
    }
    trashBusy.current = true;
    try {
      await trashRestore(row.id); // adopts the restored state + rebuilds the plan
      setTrash((t) => (t || []).filter((x) => x.id !== row.id));
      setError(null);
    } catch (err) {
      setError(err.message || "restore failed");
    }
    trashBusy.current = false;
  };

  const purgeItem = async (row) => {
    if (trashBusy.current) {
      return;
    }
    trashBusy.current = true;
    try {
      await trashPurge(row.id);
      setTrash((t) => (t || []).filter((x) => x.id !== row.id));
      setError(null);
    } catch (err) {
      setError(err.message || "delete failed");
    }
    trashBusy.current = false;
  };

  const emptyTrash = async () => {
    if (trashBusy.current) {
      return;
    }
    trashBusy.current = true;
    try {
      await trashEmpty();
      setTrash([]);
      setError(null);
    } catch (err) {
      setError(err.message || "could not empty the trash");
    }
    trashBusy.current = false;
  };

  const exportData = () => {
    // hit the export endpoint directly so the browser handles the download
    const a = document.createElement("a");
    a.href = "/api/export";
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const onImport = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // so picking the same file again re-fires onChange
    if (!file) {
      return;
    }
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      setError("That file couldn't be read — make sure it's a Michi export.");
      return;
    }
    try {
      await api.importState(data);
      await refresh();
      setError(null);
      onClose();
    } catch (err) {
      setError(err.message || "import failed");
    }
  };

  const doReset = async () => {
    try {
      await api.reset();
      await refresh();
      setError(null);
      onClose();
    } catch (err) {
      setError(err.message || "reset failed");
      setConfirmReset(false);
    }
  };

  return (
    <Modal title="Settings" onClose={onClose}>
      <Field label="Your name" hint="Used for the greeting on Today.">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name !== state.profile?.name && save((s) => (s.profile.name = name))}
          placeholder="optional"
        />
      </Field>

      <Field label="Theme">
        <div className="flex gap-2">
          {THEMES.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setSetting({ theme: id })}
              className={`flex flex-1 flex-col items-center gap-1 rounded-xl border px-3 py-2 text-xs transition ${
                settings.theme === id
                  ? "border-trail-400 bg-trail-50 text-trail-700 dark:bg-slate-800 dark:text-trail-300"
                  : "border-slate-300 text-slate-500 dark:border-slate-600"
              }`}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Intensity" hint="How hard you're pushing — sets your daily and weekly goals.">
        <div className="grid grid-cols-2 gap-2">
          {INTENSITY_LEVELS.map((lv) => {
            const active = intensity === lv.id;
            return (
              <button
                key={lv.id}
                type="button"
                aria-pressed={active}
                onClick={() => setSetting(intensityPatch(lv.id))}
                className={`flex flex-col items-start gap-0.5 rounded-xl px-3 py-2 text-left transition ${
                  active
                    ? "bg-trail-50 ring-2 ring-trail-500 dark:bg-slate-800"
                    : "ring-1 ring-slate-200 hover:ring-trail-300 dark:ring-slate-700"
                }`}
              >
                <span className="flex items-center gap-1 text-sm font-semibold text-slate-800 dark:text-slate-100">
                  {active ? (
                    <Check size={13} className="text-trail-700 dark:text-trail-400" />
                  ) : null}
                  {lv.label}
                </span>
                <span className="text-[11px] text-slate-500">{lv.blurb}</span>
                <span className="text-[11px] font-medium text-trail-700 dark:text-trail-400">
                  ~{lv.dailyGoal}/day · {lv.weeklyGoal}/week
                </span>
              </button>
            );
          })}
        </div>
      </Field>

      <div>
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          aria-expanded={showAdvanced}
          className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400 transition hover:text-trail-700 dark:hover:text-trail-400"
        >
          {showAdvanced ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Customize
          {intensity === "custom" ? (
            <Badge className="bg-iris-500/15 text-iris-600 dark:text-iris-300">custom</Badge>
          ) : null}
        </button>
        {showAdvanced ? (
          <div className="mt-3 space-y-4">
            <Field label="Daily goal" hint="Completions that count as hitting your day.">
              <Select
                value={settings.dailyGoal ?? 3}
                onChange={(e) => setCustom({ dailyGoal: Number(e.target.value) })}
              >
                {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => (
                  <option key={n} value={n}>
                    {n} per day
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="Daily time budget"
              hint="How much time the planner fills when it builds your day."
            >
              <Select
                value={settings.dailyMinutes ?? 60}
                onChange={(e) => setCustom({ dailyMinutes: Number(e.target.value) })}
              >
                {[
                  [15, "15 min"],
                  [30, "30 min"],
                  [45, "45 min"],
                  [60, "1 hour"],
                  [90, "1.5 hours"],
                  [120, "2 hours"],
                  [180, "3 hours"],
                ].map(([n, label]) => (
                  <option key={n} value={n}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Weekly goal" hint="Completions you aim for across the week.">
              <Select
                value={settings.weeklyGoal ?? 15}
                onChange={(e) => setCustom({ weeklyGoal: Number(e.target.value) })}
              >
                {[3, 5, 10, 15, 20, 28, 40, 50].map((n) => (
                  <option key={n} value={n}>
                    {n} per week
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Active days per week" hint="Days you aim to show up.">
              <Select
                value={settings.weeklyActiveDays ?? 5}
                onChange={(e) => setCustom({ weeklyActiveDays: Number(e.target.value) })}
              >
                {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                  <option key={n} value={n}>
                    {n} {n === 1 ? "day" : "days"}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        ) : null}
      </div>

      <Field label="Streak freezes" hint="Missed days the streak can bridge before it breaks.">
        <Select
          value={settings.streakFreezes ?? 2}
          onChange={(e) => setSetting({ streakFreezes: Number(e.target.value) })}
        >
          {[0, 1, 2, 3, 5].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </Select>
      </Field>

      <div className="border-t border-slate-200 pt-4 dark:border-slate-700">
        <p className="mb-1 text-sm font-medium text-slate-600 dark:text-slate-300">Companion</p>
        <p className="mb-2 text-xs text-slate-400">Who walks the path with you.</p>
        <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Companion">
          {SPECIES_LIST.map(({ id, label }) => {
            const current = (state.profile?.mascot || "shiba") === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={current}
                disabled={busy}
                onClick={() => pickCompanion(id)}
                className={`flex flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 text-[11px] font-medium transition ${
                  current
                    ? "bg-trail-50 text-trail-700 ring-2 ring-trail-500 dark:bg-slate-800 dark:text-trail-300"
                    : "text-slate-500 ring-1 ring-slate-200 hover:ring-trail-300 dark:ring-slate-700"
                }`}
              >
                <Mascot species={id} mood="idle" size={44} />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="border-t border-slate-200 pt-4 dark:border-slate-700">
        <p className="mb-1 flex items-center gap-1.5 text-sm font-medium text-slate-600 dark:text-slate-300">
          <Sparkles size={15} className="text-iris-500 dark:text-iris-300" /> Plan with Claude
        </p>
        <p className="mb-3 text-xs text-slate-400">
          Copy the prompt, plan and talk through your day with Claude, then paste the reply back to
          save its changes. Nothing is ever deleted by a sync.
        </p>
        <PlanWithClaude ctx={ctx} />
      </div>

      <NotificationsSection />

      <div className="border-t border-slate-200 pt-4 dark:border-slate-700">
        <div className="mb-2 flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-sm font-medium text-slate-600 dark:text-slate-300">
            <Trash2 size={15} className="text-slate-400" /> Trash
          </p>
          {trash?.length ? (
            <ConfirmButton
              label="Empty trash"
              confirm="Really empty?"
              onConfirm={emptyTrash}
              className="h-8 px-2 text-xs"
            >
              Empty trash
            </ConfirmButton>
          ) : null}
        </div>
        {trash == null ? (
          <p className="text-xs text-slate-400">Checking the trash…</p>
        ) : trash.length === 0 ? (
          <p className="text-xs text-slate-400">
            Nothing in the trash — deletes rest here for 30 days.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {trash.map((row) => {
              const Icon = TRASH_ICON[row.kind] || CheckCircle2;
              return (
                <li key={row.id} className="flex items-center gap-2.5 py-2">
                  <Icon size={15} className="shrink-0 text-slate-400" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-slate-700 dark:text-slate-200">
                      {row.title}
                    </p>
                    <p className="text-xs text-slate-400">
                      {row.kind}
                      {row.counts ? ` · ${row.counts}` : ""} · {timeAgo(row.deletedAt)}
                    </p>
                  </div>
                  <button
                    onClick={() => restoreItem(row)}
                    aria-label={`Restore ${row.title}`}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-trail-700 transition hover:bg-trail-50 dark:text-trail-400 dark:hover:bg-slate-800"
                  >
                    <Undo2 size={13} /> Restore
                  </button>
                  <ConfirmButton
                    label={`Delete ${row.title} forever`}
                    onConfirm={() => purgeItem(row)}
                    className="h-8 min-w-8 shrink-0"
                  >
                    <Trash2 size={14} />
                  </ConfirmButton>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="border-t border-slate-200 pt-4 dark:border-slate-700">
        <p className="mb-2 text-sm font-medium text-slate-600 dark:text-slate-300">Your data</p>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={exportData} className="flex-1">
            <Download size={15} /> Export
          </Button>
          <Button variant="ghost" onClick={() => fileRef.current?.click()} className="flex-1">
            <Upload size={15} /> Import
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={onImport}
          />
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Everything lives in one SQLite file on your mini PC — an export is a full backup.
        </p>
        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-sm font-medium text-slate-600 dark:text-slate-300">
              <Archive size={14} className="shrink-0 text-slate-400" /> Backups
            </p>
            <p className="mt-0.5 text-xs text-slate-400">
              {backups == null
                ? "Checking backups…"
                : backups.length === 0
                  ? "No backups yet — nightly timer not set up? See the README."
                  : `Last backup: ${timeAgo(backups[0].mtime)} · ${formatBytes(backups[0].sizeBytes)} · ${backups.length} kept`}
            </p>
          </div>
          <Button
            variant="ghost"
            onClick={backupNow}
            disabled={backupBusy}
            className="shrink-0"
            aria-label="Back up now"
          >
            {backedUp ? (
              <Check size={15} className="text-trail-700 dark:text-trail-400" />
            ) : (
              <Archive size={15} />
            )}
            {backedUp ? "Backed up ✓" : backupBusy ? "Backing up…" : "Back up now"}
          </Button>
        </div>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600 dark:bg-rose-950/40"
        >
          {error}
        </p>
      ) : null}

      <div className="border-t border-slate-200 pt-4 dark:border-slate-700">
        {/* the companion flags the danger zone — a drowsy word of caution, not a modal */}
        <div className="mb-3">
          <CoachBubble species={state.profile?.mascot} mood="sleepy" size={36} side="left">
            careful on this stretch of the trail.
          </CoachBubble>
        </div>
        {confirmReset ? (
          <div className="space-y-2">
            <p className="text-sm text-rose-600">
              This erases all roadmaps, projects, and tasks. Export first if unsure.
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setConfirmReset(false)} className="flex-1">
                Cancel
              </Button>
              <Button variant="danger" onClick={doReset} disabled={busy} className="flex-1">
                Erase everything
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="ghost" onClick={() => setConfirmReset(true)} className="text-rose-500">
            <Trash2 size={15} /> Reset all data
          </Button>
        )}
      </div>
    </Modal>
  );
}
