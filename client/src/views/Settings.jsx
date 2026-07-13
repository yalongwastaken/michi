import { useEffect, useRef, useState } from "react";
import {
  Download,
  Upload,
  Trash2,
  Sun,
  Moon,
  Monitor,
  Sparkles,
  Copy,
  Check,
  Map,
  Hammer,
  CheckCircle2,
  Undo2,
} from "lucide-react";
import { Modal, Button, ConfirmButton, Field, Input, Select } from "../ui.jsx";
import { api } from "../lib/api.js";
import { timeAgo } from "../lib/format.js";

// glyphs for what kind of thing is resting in the trash
const TRASH_ICON = { roadmap: Map, project: Hammer, task: CheckCircle2 };

const THEMES = [
  { id: "system", label: "System", icon: Monitor },
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
];

// "1 roadmap · 12 steps · 5 tasks" from a {kind: n} (or {kind: {count}}) map
function countsLabel(obj, pick = (v) => v) {
  const parts = [];
  for (const [kind, v] of Object.entries(obj || {})) {
    const n = pick(v);
    if (n > 0) {
      parts.push(`${n} ${kind.replace(/s$/, "")}${n > 1 ? "s" : ""}`);
    }
  }
  return parts.join(" · ");
}

// clipboard with a fallback for non-secure contexts (a mini PC on plain http)
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

export default function Settings({ ctx, onClose }) {
  const { state, save, refresh, busy } = ctx;
  const fileRef = useRef(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [name, setName] = useState(state.profile?.name || "");
  const [error, setError] = useState(null); // import/reset/sync problems, shown in the modal

  // the Claude round-trip: copy the export, paste the reply, preview, apply
  const [md, setMd] = useState("");
  const [preview, setPreview] = useState(null);
  const [synced, setSynced] = useState(null);
  const [copied, setCopied] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const syncing = useRef(false); // blocks a double tap from previewing/applying twice

  const settings = state.settings || {};

  const setSetting = (patch) => save((s) => Object.assign(s.settings, patch));

  // the trash list — fetched once when Settings opens (this component only
  // mounts on open, so the effect *is* the lazy load). null = still loading.
  const [trash, setTrash] = useState(null);
  const trashBusy = useRef(false); // one restore/purge at a time
  useEffect(() => {
    api
      .trash()
      .then((r) => setTrash(r.items || []))
      .catch(() => setTrash([])); // unreachable → show the calm empty state
  }, []);

  const restoreItem = async (row) => {
    if (trashBusy.current) {
      return;
    }
    trashBusy.current = true;
    try {
      await api.trashRestore(row.id);
      await refresh(); // adopt the restored state + rebuild the plan
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
      await api.trashDelete(row.id);
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
      await api.trashEmpty();
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

  const copyExport = async () => {
    if (syncing.current) {
      return;
    }
    syncing.current = true;
    try {
      await copyText(await api.exportMd());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      setError(null);
    } catch (err) {
      setError(err.message || "export failed");
    }
    syncing.current = false;
  };

  const previewSync = async () => {
    if (syncing.current || !md.trim()) {
      return;
    }
    syncing.current = true;
    setSyncBusy(true);
    try {
      setPreview(await api.syncPreview(md));
      setSynced(null);
      setError(null);
    } catch (err) {
      setPreview(null);
      setError(err.message || "couldn't read that plan");
    }
    syncing.current = false;
    setSyncBusy(false);
  };

  const applySyncNow = async () => {
    if (syncing.current) {
      return;
    }
    syncing.current = true;
    setSyncBusy(true);
    try {
      const res = await api.syncApply(md);
      await refresh(); // adopt the new state everywhere
      const bits = [
        countsLabel(res.applied?.createdCounts) &&
          `created ${countsLabel(res.applied?.createdCounts)}`,
        countsLabel(res.applied?.updatedCounts) &&
          `updated ${countsLabel(res.applied?.updatedCounts)}`,
      ].filter(Boolean);
      setSynced(`Synced — ${bits.join(" · ") || "nothing to change"}.`);
      setMd("");
      setPreview(null);
      setError(null);
    } catch (err) {
      setError(err.message || "sync failed");
    }
    syncing.current = false;
    setSyncBusy(false);
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

      <Field label="Daily goal" hint="How many things you aim to finish each day.">
        <Select
          value={settings.dailyGoal ?? 3}
          onChange={(e) => setSetting({ dailyGoal: Number(e.target.value) })}
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
          onChange={(e) => setSetting({ dailyMinutes: Number(e.target.value) })}
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
        <p className="mb-1 flex items-center gap-1.5 text-sm font-medium text-slate-600 dark:text-slate-300">
          <Sparkles size={15} className="text-iris-500" /> Plan with Claude
        </p>
        <p className="mb-3 text-xs text-slate-400">
          Export your path, ask Claude to plan or restructure it, paste the reply back. Nothing is
          ever deleted by a sync.
        </p>
        <div className="flex items-center gap-3">
          <Button variant="ghost" onClick={copyExport} className="flex-1">
            {copied ? <Check size={15} className="text-trail-600" /> : <Copy size={15} />}
            {copied ? "Copied ✓" : "Copy export for Claude"}
          </Button>
          <a
            href="/api/export.md"
            download
            className="shrink-0 text-xs text-slate-400 underline hover:text-trail-600"
          >
            download instead
          </a>
        </div>
        <textarea
          rows={8}
          value={md}
          onChange={(e) => {
            setMd(e.target.value);
            setPreview(null); // an edited paste needs a fresh preview
            setSynced(null);
          }}
          placeholder="Paste Claude's plan here…"
          aria-label="Claude's plan"
          className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-800 placeholder:text-slate-400 focus:border-trail-400 focus:outline-none focus:ring-2 focus:ring-trail-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-trail-800"
        />
        {preview ? (
          <div className="mt-2 space-y-2 rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
            {countsLabel(preview.creates, (v) => v.count) ? (
              <details>
                <summary className="cursor-pointer font-medium text-slate-700 dark:text-slate-200">
                  Creates: {countsLabel(preview.creates, (v) => v.count)}
                </summary>
                <ul className="mt-1 space-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {Object.entries(preview.creates).flatMap(([kind, v]) =>
                    (v.items || []).map((it) => (
                      <li key={`${kind}_${it.id}`}>
                        + {kind.replace(/s$/, "")} “{it.title}”
                      </li>
                    )),
                  )}
                </ul>
              </details>
            ) : (
              <p className="text-slate-500">Nothing new to create.</p>
            )}
            {preview.updates?.length ? (
              <div>
                <p className="font-medium text-slate-700 dark:text-slate-200">
                  Updates: {preview.updates.length}
                </p>
                <ul className="mt-1 space-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {preview.updates.map((u) => (
                    <li key={`${u.kind}_${u.id}`}>
                      {u.kind} “{u.title}” —{" "}
                      {Object.entries(u.changes || {})
                        .map(([f, c]) => `${f}: ${c.from ?? "—"} → ${c.to ?? "—"}`)
                        .join(" · ")}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-xs text-slate-500">No updates to existing items.</p>
            )}
            {preview.warnings?.length ? (
              <ul className="space-y-0.5 text-xs text-amber-600 dark:text-amber-500">
                {preview.warnings.map((w, i) => (
                  <li key={i}>⚠ {w}</li>
                ))}
              </ul>
            ) : null}
            <div className="flex gap-2 pt-1">
              <Button onClick={applySyncNow} disabled={syncBusy} className="flex-1">
                Apply sync
              </Button>
              <Button variant="ghost" onClick={() => setPreview(null)} className="flex-1">
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="subtle"
            onClick={previewSync}
            disabled={syncBusy || !md.trim()}
            className="mt-2 w-full"
          >
            Preview sync
          </Button>
        )}
        {synced ? (
          <p role="status" className="mt-2 text-sm text-trail-600 dark:text-trail-400">
            {synced}
          </p>
        ) : null}
      </div>

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
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-trail-600 transition hover:bg-trail-50 dark:text-trail-400 dark:hover:bg-slate-800"
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
