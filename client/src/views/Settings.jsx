import { useRef, useState } from "react";
import { Download, Upload, Trash2, Sun, Moon, Monitor } from "lucide-react";
import { Modal, Button, Field, Input, Select } from "../ui.jsx";
import { api } from "../lib/api.js";

const THEMES = [
  { id: "system", label: "System", icon: Monitor },
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
];

export default function Settings({ ctx, onClose }) {
  const { state, save, refresh, busy } = ctx;
  const fileRef = useRef(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [name, setName] = useState(state.profile?.name || "");

  const settings = state.settings || {};

  const setSetting = (patch) => save((s) => Object.assign(s.settings, patch));

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
    if (!file) {
      return;
    }
    try {
      const data = JSON.parse(await file.text());
      await api.importState(data);
      await refresh();
      onClose();
    } catch {
      alert("That file couldn't be imported — make sure it's a Michi export.");
    }
  };

  const doReset = async () => {
    await api.reset();
    await refresh();
    onClose();
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
