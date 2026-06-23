import { useCallback, useEffect, useState } from "react";
import { Sun, Map, Hammer, Flame, Settings as SettingsIcon, AlertTriangle } from "lucide-react";
import { api } from "./lib/api.js";
import { todayKey } from "./lib/format.js";
import Today from "./views/Today.jsx";
import Roadmaps from "./views/Roadmaps.jsx";
import Projects from "./views/Projects.jsx";
import Momentum from "./views/Momentum.jsx";
import Settings from "./views/Settings.jsx";
import Onboarding from "./views/Onboarding.jsx";
import { Logo } from "./views/Logo.jsx";

const TABS = [
  { id: "today", label: "Today", icon: Sun },
  { id: "roadmaps", label: "Roadmaps", icon: Map },
  { id: "projects", label: "Projects", icon: Hammer },
  { id: "momentum", label: "Momentum", icon: Flame },
];

export default function App({ onTheme }) {
  const [state, setState] = useState(null);
  const [today, setToday] = useState(null);
  const [momentum, setMomentum] = useState(null);
  const [tab, setTab] = useState("today");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const day = todayKey();

  const refreshDerived = useCallback(async () => {
    const [t, m] = await Promise.all([api.today(day), api.momentum(day)]);
    setToday(t);
    setMomentum(m);
  }, [day]);

  const load = useCallback(async () => {
    try {
      const s = await api.getState();
      setState(s);
      onTheme?.(s.settings?.theme || "system");
      await refreshDerived();
      setError(null);
    } catch (e) {
      setError(e.message || "could not reach the server");
    }
  }, [onTheme, refreshDerived]);

  useEffect(() => {
    load();
  }, [load]);

  // full-state edit: clone → mutate → PUT (with rev) → adopt result → refresh derived
  const save = useCallback(
    async (mutator) => {
      if (!state) {
        return;
      }
      setBusy(true);
      try {
        const next = structuredClone(state);
        mutator(next);
        const saved = await api.putState({ ...next, rev: state.rev });
        setState(saved);
        onTheme?.(saved.settings?.theme || "system");
        await refreshDerived();
        setError(null);
      } catch (e) {
        // a 409 means another tab saved first — reload the truth
        if (e.status === 409) {
          await load();
        }
        setError(e.message || "save failed");
      } finally {
        setBusy(false);
      }
    },
    [state, onTheme, refreshDerived, load],
  );

  // lean completion toggle (the hot path) — doesn't go through full-state PUT
  const complete = useCallback(
    async (kind, id, done) => {
      setBusy(true);
      try {
        const saved = await api.complete(kind, id, done);
        setState(saved);
        await refreshDerived();
      } catch (e) {
        setError(e.message || "could not update");
      } finally {
        setBusy(false);
      }
    },
    [refreshDerived],
  );

  const addTask = useCallback(
    async (task) => {
      setBusy(true);
      try {
        const saved = await api.addTask(task);
        setState(saved);
        await refreshDerived();
      } catch (e) {
        setError(e.message || "could not add task");
      } finally {
        setBusy(false);
      }
    },
    [refreshDerived],
  );

  if (!state) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-400">
        {error ? (
          <div className="flex max-w-xs flex-col items-center gap-2 text-center">
            <AlertTriangle className="text-amber-500" />
            <p>{error}</p>
            <button className="text-trail-600 underline" onClick={load}>
              retry
            </button>
          </div>
        ) : (
          <Logo className="h-10 w-10 animate-pulse" />
        )}
      </div>
    );
  }

  if (!state.profile?.onboarded) {
    return <Onboarding save={save} busy={busy} />;
  }

  const ctx = { state, today, momentum, day, save, complete, addTask, refresh: load, busy };

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col">
      <header className="trail-gradient sticky top-0 z-20 border-b border-slate-200/60 dark:border-slate-800/80 px-4 pb-3 pt-4 backdrop-blur">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Logo className="h-8 w-8" />
            <div>
              <h1 className="text-xl font-semibold leading-none text-slate-800 dark:text-slate-100">
                Michi
              </h1>
              <p className="text-xs text-slate-500">find your way</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {momentum?.streak ? (
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-sm font-semibold ${
                  momentum.streak.atRisk
                    ? "bg-amber-50 text-amber-600 dark:bg-amber-950/40"
                    : "bg-iris-500/15 text-iris-600 dark:text-iris-300"
                }`}
                title={momentum.streak.atRisk ? "do something today to keep it!" : "current streak"}
              >
                <Flame size={15} />
                {momentum.streak.current}
              </span>
            ) : null}
            <button
              aria-label="Settings"
              onClick={() => setSettingsOpen(true)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 hover:bg-white/60 dark:hover:bg-slate-800"
            >
              <SettingsIcon size={18} />
            </button>
          </div>
        </div>
      </header>

      {error ? (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-950/40">
          <AlertTriangle size={15} /> {error}
        </div>
      ) : null}

      <main className="flex-1 px-4 py-4 pb-28">
        {tab === "today" && <Today ctx={ctx} />}
        {tab === "roadmaps" && <Roadmaps ctx={ctx} />}
        {tab === "projects" && <Projects ctx={ctx} />}
        {tab === "momentum" && <Momentum ctx={ctx} />}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl">
          {TABS.map(({ id, label, icon: Icon }) => {
            const active = tab === id;
            const badge =
              id === "today" && today ? today.counts.overdue + today.counts.dueToday : 0;
            return (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`relative flex flex-1 flex-col items-center gap-0.5 py-2.5 text-xs font-medium transition ${
                  active ? "text-trail-600 dark:text-trail-400" : "text-slate-400"
                }`}
              >
                <Icon size={20} className={active ? "pop" : ""} />
                {label}
                {badge > 0 ? (
                  <span className="absolute right-[26%] top-1.5 min-w-4 rounded-full bg-trail-500 px-1 text-[10px] font-bold leading-4 text-white">
                    {badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </nav>

      {settingsOpen && <Settings ctx={ctx} onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
