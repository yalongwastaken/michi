import { useCallback, useEffect, useRef, useState } from "react";
import { Sun, Map, Hammer, Flame, Settings as SettingsIcon, AlertTriangle } from "lucide-react";
import { api } from "./lib/api.js";
import { todayKey } from "./lib/format.js";
import { createQueue } from "./lib/queue.js";
import Today from "./views/Today.jsx";
import Roadmaps from "./views/Roadmaps.jsx";
import Projects from "./views/Projects.jsx";
import Momentum from "./views/Momentum.jsx";
import Settings from "./views/Settings.jsx";
import Onboarding from "./views/Onboarding.jsx";
import Celebration from "./views/Celebration.jsx";
import UndoToast from "./views/UndoToast.jsx";
import Mascot from "./views/Mascot.jsx";
import { Logo } from "./views/Logo.jsx";
import { checkCelebrations, confettiBurst } from "./lib/celebrate.js";

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

const LOADING_LINES = ["finding the trail…", "lacing boots…", "reading the map…"];

function Loading() {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
      return undefined; // one steady line is calmer
    }
    const t = setInterval(() => setI((v) => (v + 1) % LOADING_LINES.length), 1800);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex flex-col items-center gap-3">
      {/* the profile hasn't loaded yet, so the chosen companion is unknown — the
          default shiba holds the trail until the state arrives */}
      <Mascot species="shiba" mood="idle" size={72} />
      <p className="text-xs text-slate-400">{LOADING_LINES[i]}</p>
    </div>
  );
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
  const [review, setReview] = useState(null);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [tab, setTab] = useState("today");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [celebration, setCelebration] = useState(null);
  const [undo, setUndo] = useState(null); // { ids, title, count } — one toast at a time

  // today's key is state (not a per-render constant) so an installed PWA that sits
  // open overnight rolls over to the new day when it refetches
  const [day, setDay] = useState(todayKey);

  // latest state, readable inside queued writes (closures would otherwise be stale)
  const stateRef = useRef(null);
  const applyState = useCallback((s) => {
    stateRef.current = s;
    setState(s);
  }, []);

  // serialize every write (see lib/queue.js) so two quick edits can't race the
  // optimistic-concurrency rev into a 409; the busy flag spans the whole queue.
  // Lazy init: createQueue must run once, not on every render.
  const [enqueue] = useState(() => createQueue(setBusy));

  // monotonic guard: derived-data responses can arrive out of order (a slow AI replan
  // vs a quick dashboard refresh), so only the most recently *issued* request applies.
  const derivedSeqRef = useRef(0);

  // "one more" raises the day's budget; hold it here so later refreshes rebuild the
  // plan at the same size instead of shrinking back to settings. Cleared on rollover,
  // and whenever a save changes settings.dailyMinutes — an explicit budget choice
  // (chips, Settings) must always beat a stale boost.
  const budgetBoostRef = useRef(null); // { day, budget } | null

  // when the last derived refresh landed — throttles the wake-up listeners below
  const lastDerivedAtRef = useRef(0);

  // one round-trip for the whole Today screen (queue + momentum + plan + nudges).
  // Reads the clock at call time so every refresh targets the *current* day.
  const refreshDerived = useCallback(async () => {
    const d = todayKey();
    setDay(d);
    if (budgetBoostRef.current && budgetBoostRef.current.day !== d) {
      budgetBoostRef.current = null; // the boost belonged to a day that's over
    }
    const seq = ++derivedSeqRef.current;
    const resp = await api.dashboard(d, { budget: budgetBoostRef.current?.budget });
    if (seq !== derivedSeqRef.current) {
      return; // a newer request superseded this one
    }
    lastDerivedAtRef.current = Date.now();
    setToday(resp.today);
    setMomentum(resp.momentum);
    setPlan(resp.plan);
    setNudges(resp.insights || []);
    setReview(resp.review || null);
  }, []);

  // re-run the planner; {ai:true} asks the local model, {budget} overrides the budget
  const replan = useCallback(
    async ({ ai = false, budget } = {}) => {
      const seq = ++derivedSeqRef.current;
      try {
        if (budget != null) {
          budgetBoostRef.current = { day, budget }; // keep "one more" across refreshes
        }
        const boost =
          budgetBoostRef.current?.day === day ? budgetBoostRef.current.budget : undefined;
        const p = await api.plan(day, { ai, budget: boost });
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

  // game layer: each fresh momentum payload is checked against the last-celebrated
  // record (localStorage) — at most one confetti burst + toast per new feat
  useEffect(() => {
    const ev = checkCelebrations(momentum);
    if (ev) {
      confettiBurst();
      setCelebration(ev);
    }
  }, [momentum]);

  // resilience: an installed PWA sits open for days — when the app comes back into
  // view (or the network returns), catch up. A day rollover reloads everything
  // (yesterday's plan, greeting, and streak are stale); otherwise a derived refresh
  // suffices, throttled so focus + visibilitychange firing together don't double-hit.
  useEffect(() => {
    const wake = () => {
      if (document.visibilityState === "hidden") {
        return;
      }
      if (todayKey() !== day) {
        load(); // slept past midnight — refetch the full state, not just the plan
        return;
      }
      if (Date.now() - lastDerivedAtRef.current < 15000) {
        return; // refreshed moments ago
      }
      refreshDerived().catch(() => {}); // best-effort; the next wake retries
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    return () => {
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", wake);
    };
  }, [day, load, refreshDerived]);

  // the wake listeners only fire on transitions — a device that just stays visible
  // (a kiosk, a propped-up tablet) would sit on yesterday forever. A slow tick
  // catches midnight for that case; hidden tabs skip it (visibilitychange handles
  // the return), so this never wakes a backgrounded phone.
  useEffect(() => {
    const t = setInterval(() => {
      if (!document.hidden && todayKey() !== day) {
        load(); // same rollover path as the wake handler: full refetch
      }
    }, 60000);
    return () => clearInterval(t);
  }, [day, load]);

  // full-state edit: clone latest → mutate → PUT (with fresh rev) → adopt → refresh.
  // Resolves to true on success, false on failure (never throws — callers can await).
  const save = useCallback(
    (mutator) =>
      enqueue(async () => {
        if (!stateRef.current) {
          return false;
        }
        // remembered so a save that changes the budget can retire a "one more" boost
        const budgetBefore = stateRef.current.settings?.dailyMinutes;
        // clone the latest truth, apply the edit, PUT with that truth's rev
        const attempt = () => {
          const next = structuredClone(stateRef.current);
          mutator(next);
          return api.putState({ ...next, rev: stateRef.current.rev });
        };
        let saved;
        try {
          saved = await attempt();
        } catch (e) {
          if (e.status !== 409) {
            setError(e.message || "save failed");
            return false;
          }
          // someone saved first — adopt the fresh truth (the 409 carries it),
          // re-apply the edit on top, and retry once before bothering the user
          try {
            applyState(e.body?.state || (await api.getState()));
            saved = await attempt();
          } catch (e2) {
            setError(e2.message || "save failed");
            return false;
          }
        }
        // the PUT's response carries a `trashed` receipt naming exactly what this
        // write snapshotted into trash — the undo toast binds to those rows by id
        // instead of guessing at the newest trash entry. Peeled off before the
        // state is adopted (it's a write receipt, not model state); import/sync
        // responses never carry it, so `[]` is the quiet default.
        const { trashed = [], ...fresh } = saved;
        applyState(fresh);
        onTheme?.(fresh.settings?.theme || "system");
        if (fresh.settings?.dailyMinutes !== budgetBefore) {
          budgetBoostRef.current = null; // a chosen budget beats a stale "one more"
        }
        if (Array.isArray(trashed) && trashed.length > 0) {
          setUndo({
            ids: trashed.map((r) => r.id),
            title: trashed[0].title,
            count: trashed.length,
          });
        }
        setError(null);
        // the PUT succeeded — a failed follow-up refresh must not report failure
        // (the modal would stay open and a retry would duplicate the edit)
        try {
          await refreshDerived();
        } catch {
          setError("saved — couldn't refresh the plan");
        }
        return true;
      }),
    [enqueue, applyState, onTheme, refreshDerived],
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
        } catch (e) {
          // the POST failed — undo the optimistic flip locally first, because the
          // server is likely unreachable and a truth-refresh would fail the same way
          setPlan((p) => patchPlan(p, kind, id, !done));
          setToday((t) => patchToday(t, kind, id, !done));
          setError(e.message || "could not update");
          try {
            await refreshDerived(); // best-effort reconcile with server truth
          } catch {
            /* still offline — the local revert above already put things right */
          }
          return false;
        }
        // the POST succeeded — a failed follow-up refresh must not report failure
        // (same contract as save(): the tick landed, only the replan is stale)
        try {
          await refreshDerived();
        } catch {
          setError("saved — couldn't refresh the plan");
        }
        return true;
      });
    },
    [enqueue, applyState, refreshDerived],
  );

  // the toast's Undo: restore every row the PUT trashed (its receipt can name
  // several — a roadmap plus the tasks that vanished with it), adopting the
  // final state once. Enqueued so it can't interleave with a save in flight.
  const undoDelete = useCallback(() => {
    const u = undo;
    setUndo(null);
    if (!u) {
      return Promise.resolve(false);
    }
    return enqueue(async () => {
      let state = null; // the last truth a restore handed back
      try {
        for (const id of u.ids) {
          state = (await api.trashRestore(id)).state;
        }
      } catch (e) {
        setError(e.message || "could not restore");
        if (state) {
          applyState(state); // keep whatever DID come back before the failure
        }
        return false;
      }
      applyState(state);
      try {
        await refreshDerived();
      } catch {
        setError("restored — couldn't refresh the plan");
      }
      return true;
    });
  }, [undo, enqueue, applyState, refreshDerived]);

  // Settings' trash actions ride the same write queue as saves — a restore that
  // adopted state outside the queue could transiently regress stateRef while a
  // save was in flight. Rejections propagate so Settings shows them in-modal.
  const trashRestore = useCallback(
    (id) =>
      enqueue(async () => {
        const res = await api.trashRestore(id);
        applyState(res.state);
        await refreshDerived().catch(() => {}); // best-effort; the restore landed
        return res;
      }),
    [enqueue, applyState, refreshDerived],
  );
  const trashPurge = useCallback((id) => enqueue(() => api.trashDelete(id)), [enqueue]);
  const trashEmpty = useCallback(() => enqueue(() => api.trashEmpty()), [enqueue]);

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
            <button className="text-trail-700 underline dark:text-trail-400" onClick={load}>
              retry
            </button>
          </div>
        ) : (
          <Loading />
        )}
      </div>
    );
  }

  // the banner has to exist during onboarding too — a failed first save is invisible otherwise
  const errorBanner = error ? (
    <div
      role="alert"
      className="mx-4 mt-3 flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
    >
      <AlertTriangle size={15} /> {error}
    </div>
  ) : null;

  if (!state.profile?.onboarded) {
    return (
      <>
        {errorBanner}
        <Onboarding save={save} busy={busy} />
      </>
    );
  }

  const ctx = {
    state,
    today,
    momentum,
    plan,
    nudges,
    review,
    aiEnabled,
    replan,
    skipPlanItem,
    day,
    save,
    complete,
    addTask,
    trashRestore,
    trashPurge,
    trashEmpty,
    setTab,
    refresh: load,
    busy,
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col">
      <header className="sticky top-0 z-20 border-b border-slate-200/60 bg-sand-50/85 dark:border-slate-800/80 dark:bg-slate-950/80 px-4 pb-3 pt-4 backdrop-blur">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Logo className="h-8 w-8" />
            <div>
              <h1 className="text-xl font-semibold leading-none text-slate-800 dark:text-slate-100">
                Michi
              </h1>
              <p className="text-xs text-slate-500">one step down the path, every day</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {momentum?.streak ? (
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-sm font-semibold ${
                  momentum.streak.atRisk
                    ? "bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300"
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

      {errorBanner}

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
                    ? "text-trail-700 dark:text-trail-400"
                    : "text-slate-500 dark:text-slate-400"
                }`}
              >
                <Icon size={20} className={active ? "pop" : ""} />
                {label}
                {badge > 0 ? (
                  <span
                    aria-label={`${badge} needing attention`}
                    className="absolute right-[26%] top-1.5 min-w-4 rounded-full bg-trail-600 px-1 text-[10px] font-bold leading-4 text-white"
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
      {celebration ? (
        <Celebration
          event={celebration}
          species={state.profile?.mascot}
          onClose={() => setCelebration(null)}
        />
      ) : null}
      {undo ? <UndoToast toast={undo} onUndo={undoDelete} onClose={() => setUndo(null)} /> : null}
    </div>
  );
}
