import { useCallback, useEffect, useRef, useState } from "react";
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

// optimistic helpers: flip an item's status locally so the checkbox responds instantly,
// before the server round-trip. The authoritative dashboard refresh reconciles after.
const flip = (it, kind, id, done) =>
  it.kind === kind && it.id === id ? { ...it, status: done ? "done" : "todo" } : it;

function patchPlan(plan, kind, id, done) {
  if (!plan) {
    return plan;
  }
  return { ...plan, items: plan.items.map((it) => flip(it, kind, id, done)) };
}

function patchToday(today, kind, id, done) {
  if (!today) {
    return today;
  }
  const map = (arr) => (arr || []).map((it) => flip(it, kind, id, done));
  return {
    ...today,
    overdue: map(today.overdue),
    dueToday: map(today.dueToday),
    suggested: map(today.suggested),
  };
}

export default function App({ onTheme }) {
  const [state, setState] = useState(null);
  const [today, setToday] = useState(null);
  const [momentum, setMomentum] = useState(null);
  const [plan, setPlan] = useState(null);
  const [nudges, setNudges] = useState([]);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [tab, setTab] = useState("today");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const day = todayKey();

  // latest state, readable inside queued writes (closures would otherwise be stale)
  const stateRef = useRef(null);
  const applyState = useCallback((s) => {
    stateRef.current = s;
    setState(s);
  }, []);

  // serialize every write: each job runs after the previous settles, so two quick
  // edits can't race the optimistic-concurrency rev into a 409. A pending counter
  // drives the global busy flag across the whole queue (no flicker between ops).
  const queueRef = useRef(Promise.resolve());
  const pendingRef = useRef(0);
  const enqueue = useCallback((job) => {
    pendingRef.current += 1;
    setBusy(true);
    const run = queueRef.current.then(job, job);
    queueRef.current = run.then(
      () => {},
      () => {},
    );
    queueRef.current.finally(() => {
      pendingRef.current -= 1;
      if (pendingRef.current <= 0) {
        pendingRef.current = 0;
        setBusy(false);
      }
    });
    return run;
  }, []);

  // monotonic guard: derived-data responses can arrive out of order (a slow AI replan
  // vs a quick dashboard refresh), so only the most recently *issued* request applies.
  const derivedSeqRef = useRef(0);

  // one round-trip for the whole Today screen (queue + momentum + plan + nudges)
  const refreshDerived = useCallback(async () => {
    const seq = ++derivedSeqRef.current;
    const d = await api.dashboard(day);
    if (seq !== derivedSeqRef.current) {
      return; // a newer request superseded this one
    }
    setToday(d.today);
    setMomentum(d.momentum);
    setPlan(d.plan);
    setNudges(d.insights || []);
  }, [day]);

  // re-run the planner; {ai:true} asks the local model, {budget} overrides the budget
  const replan = useCallback(
    async ({ ai = false, budget } = {}) => {
      const seq = ++derivedSeqRef.current;
      try {
        const p = await api.plan(day, { ai, budget });
        if (seq === derivedSeqRef.current) {
          setPlan(p);
        }
      } catch (e) {
        setError(e.message || "could not build a plan");
      }
    },
    [day],
  );

  // push a plan item off today ("not today"), or restore it
  const skipPlanItem = useCallback(
    async (kind, id, on = true) => {
      const seq = ++derivedSeqRef.current;
      try {
        const p = await api.skipPlanItem(kind, id, day, on);
        if (seq === derivedSeqRef.current) {
          setPlan(p);
        }
      } catch (e) {
        setError(e.message || "could not update the plan");
      }
    },
    [day],
  );

  const load = useCallback(async () => {
    try {
      const [s, cfg] = await Promise.all([
        api.getState(),
        api.config().catch(() => ({ ai: false })),
      ]);
      applyState(s);
      setAiEnabled(!!cfg.ai);
      onTheme?.(s.settings?.theme || "system");
      await refreshDerived();
      setError(null);
    } catch (e) {
      setError(e.message || "could not reach the server");
    }
  }, [applyState, onTheme, refreshDerived]);

  useEffect(() => {
    load();
  }, [load]);

  // full-state edit: clone latest → mutate → PUT (with fresh rev) → adopt → refresh.
  // Resolves to true on success, false on failure (never throws — callers can await).
  const save = useCallback(
    (mutator) =>
      enqueue(async () => {
        const cur = stateRef.current;
        if (!cur) {
          return false;
        }
        try {
          const next = structuredClone(cur);
          mutator(next);
          const saved = await api.putState({ ...next, rev: cur.rev });
          applyState(saved);
          onTheme?.(saved.settings?.theme || "system");
          await refreshDerived();
          setError(null);
          return true;
        } catch (e) {
          if (e.status === 409) {
            await load(); // someone saved first — reload the truth
          }
          setError(e.message || "save failed");
          return false;
        }
      }),
    [enqueue, applyState, onTheme, refreshDerived, load],
  );

  // lean completion toggle (the hot path) — serialized for ordering, optimistic for feel
  const complete = useCallback(
    (kind, id, done) => {
      // reflect immediately; the authoritative refresh inside the job reconciles
      setPlan((p) => patchPlan(p, kind, id, done));
      setToday((t) => patchToday(t, kind, id, done));
      return enqueue(async () => {
        try {
          applyState(await api.complete(kind, id, done));
          await refreshDerived();
          return true;
        } catch (e) {
          setError(e.message || "could not update");
          await refreshDerived(); // roll the optimistic flip back to server truth
          return false;
        }
      });
    },
    [enqueue, applyState, refreshDerived],
  );

  const addTask = useCallback(
    (task) =>
      enqueue(async () => {
        try {
          applyState(await api.addTask(task));
          await refreshDerived();
          return true;
        } catch (e) {
          setError(e.message || "could not add task");
          return false;
        }
      }),
    [enqueue, applyState, refreshDerived],
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

  const ctx = {
    state,
    today,
    momentum,
    plan,
    nudges,
    aiEnabled,
    replan,
    skipPlanItem,
    day,
    save,
    complete,
    addTask,
    refresh: load,
    busy,
  };

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
                aria-label={`${momentum.streak.current} day streak${momentum.streak.atRisk ? ", at risk" : ""}`}
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
        <div
          role="alert"
          className="mx-4 mt-3 flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-950/40"
        >
          <AlertTriangle size={15} /> {error}
        </div>
      ) : null}

      <main className="flex-1 px-4 py-4 pb-28">
        {tab === "today" && <Today ctx={ctx} />}
        {tab === "roadmaps" && <Roadmaps ctx={ctx} />}
        {tab === "projects" && <Projects ctx={ctx} />}
        {tab === "momentum" && <Momentum ctx={ctx} />}
      </main>

      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
      >
        <div className="mx-auto flex max-w-2xl">
          {TABS.map(({ id, label, icon: Icon }) => {
            const active = tab === id;
            const badge =
              id === "today" && today ? today.counts.overdue + today.counts.dueToday : 0;
            return (
              <button
                key={id}
                onClick={() => setTab(id)}
                aria-current={active ? "page" : undefined}
                className={`relative flex flex-1 flex-col items-center gap-0.5 py-2.5 text-xs font-medium transition ${
                  active
                    ? "text-trail-600 dark:text-trail-400"
                    : "text-slate-500 dark:text-slate-400"
                }`}
              >
                <Icon size={20} className={active ? "pop" : ""} />
                {label}
                {badge > 0 ? (
                  <span
                    aria-label={`${badge} needing attention`}
                    className="absolute right-[26%] top-1.5 min-w-4 rounded-full bg-trail-500 px-1 text-[10px] font-bold leading-4 text-white"
                  >
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
