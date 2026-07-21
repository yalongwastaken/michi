// Focus.jsx — the 集中 focus tab: a Pomodoro timer that works WITH the day's plan.
// Pick what this block is targeting (today's tasks/steps, or a free-typed goal),
// optionally let the local model phrase the intention, then run a work→break cycle.
// When a block ends the server sends a push (Settings → Notifications) and, if the
// tab is open, an in-app chime; every finished work block is logged to the journal.
import { useEffect, useRef, useState } from "react";
import {
  Play,
  Pause,
  RotateCcw,
  SkipForward,
  Sparkles,
  Timer,
  Check,
  Bell,
  Minimize2,
  Maximize2,
} from "lucide-react";
import { Card, Button, Badge } from "../ui.jsx";
import { api } from "../lib/api.js";

// preset (work, break) minute pairs — the classic 25/5 up to a deep 50/10
const PRESETS = [
  [25, 5],
  [50, 10],
  [15, 3],
];

const mmss = (secs) => {
  const s = Math.max(0, Math.round(secs));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

// minutes since local midnight — the journal stores start/end that way
const minsNow = () => {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
};

// a short two-tone chime via WebAudio — no asset, degrades silently where blocked
function chime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) {
      return;
    }
    const ac = new Ctx();
    const notes = [660, 880];
    notes.forEach((freq, i) => {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.frequency.value = freq;
      osc.type = "sine";
      const t = ac.currentTime + i * 0.18;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.2, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      osc.connect(gain).connect(ac.destination);
      osc.start(t);
      osc.stop(t + 0.18);
    });
    setTimeout(() => ac.close?.(), 800);
  } catch {
    /* audio blocked (autoplay policy, no context) — the push/visual still land */
  }
}

export default function Focus({ ctx }) {
  const { plan, day } = ctx;

  const [workMin, setWorkMin] = useState(25);
  const [breakMin, setBreakMin] = useState(5);
  const [phase, setPhase] = useState("work"); // work | break
  const [running, setRunning] = useState(false);
  const [remaining, setRemaining] = useState(25 * 60); // seconds left in the phase
  const [sessions, setSessions] = useState(0); // work blocks finished this sitting
  const [goal, setGoal] = useState("");
  const [picked, setPicked] = useState(() => new Set()); // target ids for this block
  const [suggesting, setSuggesting] = useState(false);
  const [note, setNote] = useState(null); // small status line ("logged to journal")
  const [immersive, setImmersive] = useState(false); // full-screen while a block runs

  const endAtRef = useRef(null); // wall-clock end (robust to tab throttling)
  const reminderRef = useRef(null); // server reminder id, for cancel on pause/reset
  const reminderTokenRef = useRef(0); // invalidates an in-flight schedule on pause/reset
  const blockStartRef = useRef(null); // minutes-since-midnight when a work block began
  const blockDayRef = useRef(null); // the local day the work block began (journal filing)
  const onPhaseEndRef = useRef(null); // always the freshest onPhaseEnd (no stale closure)
  const endingRef = useRef(false); // guards a double-fire of onPhaseEnd (double-tap Skip)

  // candidate targets: today's plan items still to do (steps carry their roadmap as
  // the "topic"); the picker tags a block without changing the plan itself
  const targets = (plan?.items || [])
    .filter((it) => it.status !== "done")
    .map((it) => ({
      kind: it.kind,
      id: it.id,
      title: it.title,
      topic: it.roadmapTitle || null,
      projectId: it.projectId || null,
      stepId: it.kind === "step" ? it.id : null,
    }));
  const chosen = targets.filter((t) => picked.has(t.id));

  // reset the clock to a phase's full length whenever the phase or its length changes
  // while idle (a running timer owns `remaining` and must not be stomped)
  useEffect(() => {
    if (!running) {
      setRemaining((phase === "work" ? workMin : breakMin) * 60);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, workMin, breakMin]);

  // the tick: derive `remaining` from the wall-clock end so a throttled/backgrounded
  // tab still lands on zero at the right moment. onEnd fires exactly once per phase.
  useEffect(() => {
    if (!running) {
      return undefined;
    }
    const t = setInterval(() => {
      const left = Math.round((endAtRef.current - Date.now()) / 1000);
      if (left <= 0) {
        setRemaining(0);
        clearInterval(t);
        onPhaseEndRef.current?.(); // freshest closure → current goal/targets/phase
      } else {
        setRemaining(left);
      }
    }, 250);
    return () => clearInterval(t);
  }, [running]);

  // schedule the end-of-block push (best-effort — no subscription just means no push).
  // Token-guarded: the id lands only after an await, so a pause/reset that happens
  // mid-flight bumps the token and this call cancels the just-made reminder instead
  // of leaving it to fire on a block that's no longer running.
  const scheduleReminder = async (secs, isWork) => {
    const tok = ++reminderTokenRef.current;
    try {
      const { id } = await api.focus.schedule({
        dueAt: Date.now() + secs * 1000,
        title: isWork ? "Focus block done" : "Break over",
        body: isWork
          ? `${goal ? `“${goal}” — ` : ""}time's up. Take a break or start the next block.`
          : "Break's over — ready for the next focus block?",
      });
      if (tok !== reminderTokenRef.current) {
        api.focus.cancel(id).catch(() => {}); // superseded while in flight — undo it
        return;
      }
      reminderRef.current = id;
    } catch {
      if (tok === reminderTokenRef.current) {
        reminderRef.current = null; // scheduling failed (offline) — the chime still fires
      }
    }
  };

  const cancelReminder = async () => {
    reminderTokenRef.current++; // invalidate any schedule still in flight
    const id = reminderRef.current;
    reminderRef.current = null;
    if (id) {
      try {
        await api.focus.cancel(id);
      } catch {
        /* a reminder we can't cancel will fire once — harmless */
      }
    }
  };

  const start = () => {
    setNote(null);
    endAtRef.current = Date.now() + remaining * 1000;
    if (phase === "work" && blockStartRef.current == null) {
      blockStartRef.current = minsNow();
      blockDayRef.current = day; // file the journal entry under the day it began
    }
    setRunning(true);
    setImmersive(true); // starting a block takes over the screen
    scheduleReminder(remaining, phase === "work");
  };

  const pause = () => {
    setRunning(false);
    cancelReminder();
  };

  const reset = () => {
    setRunning(false);
    setImmersive(false);
    cancelReminder();
    blockStartRef.current = null;
    setPhase("work");
    setRemaining(workMin * 60);
  };

  // log the work block just finished to the journal / time log
  const logBlock = async () => {
    const startMin = blockStartRef.current ?? minsNow();
    const nowMin = minsNow();
    // crossed midnight → the tail belongs to tomorrow; keep this entry on the start
    // day and run it to end-of-day rather than collapsing to a zero-length entry
    const endMin = nowMin < startMin ? 1440 : Math.min(1440, nowMin);
    const single = chosen.length === 1 ? chosen[0] : null;
    try {
      await api.journal.add({
        day: blockDayRef.current || day,
        title: goal.trim() || (single ? single.title : "Focus block"),
        startMin,
        endMin,
        note: chosen.length
          ? `Focus block · ${chosen.map((t) => t.title).join(", ")}`
          : "Focus block",
        projectId: single?.projectId || null,
        stepId: single?.stepId || null,
      });
      setNote("Block done — logged to your journal.");
    } catch {
      setNote("Block done — couldn't log it, but the timer ran.");
    }
  };

  // a phase reached zero (or was skipped): chime, settle, and set up the NEXT phase
  // idle. We never auto-restart the clock here — a plain running:false→next-phase-idle
  // avoids the toggle-in-place that would strand the interval. Tap Start for the break.
  const onPhaseEnd = async () => {
    if (endingRef.current) {
      return; // guard a double-tap Skip / an overlapping fire → one log, one increment
    }
    endingRef.current = true;
    chime();
    setRunning(false);
    reminderRef.current = null; // the server just fired it (or skip cancelled it)
    if (phase === "work") {
      setSessions((n) => n + 1);
      await logBlock();
      blockStartRef.current = null;
      blockDayRef.current = null;
      setPhase("break");
      setRemaining(breakMin * 60);
    } else {
      setPhase("work");
      setRemaining(workMin * 60);
      setImmersive(false); // the break finished — drop back to the setup view
      setNote("Break's over — set your next block.");
    }
    endingRef.current = false;
  };
  // keep the interval's ref pointing at the freshest closure (current goal/targets)
  onPhaseEndRef.current = onPhaseEnd;

  // end this phase early — only meaningful while it's running
  const skip = () => {
    if (!running) {
      return;
    }
    endAtRef.current = Date.now();
    cancelReminder();
    onPhaseEnd();
  };

  const suggest = async () => {
    setSuggesting(true);
    try {
      const { suggestion } = await api.focus.suggest(
        (chosen.length ? chosen : targets).slice(0, 8).map((t) => ({ title: t.title })),
      );
      if (suggestion) {
        setGoal(suggestion);
      }
    } catch {
      /* suggestion is a nicety — leave the field as-is on failure */
    }
    setSuggesting(false);
  };

  const togglePick = (id) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });

  const isWork = phase === "work";
  const total = (isWork ? workMin : breakMin) * 60;
  const pct = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0;
  const midBlock = running || remaining < total; // a block is underway (running or paused)

  // ── full-screen immersive block ─────────────────────────────────────────────
  // While a block runs it takes over the whole viewport (covers the header, nav,
  // and FAB via z-50) so there's nothing to look at but the clock. Minimize drops
  // back to the tab WITHOUT stopping the timer; End (reset) stops the block.
  if (immersive) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-sand-50 px-6 dark:bg-slate-950">
        <button
          onClick={() => setImmersive(false)}
          aria-label="Exit full screen (keep the timer running)"
          style={{ top: "calc(1rem + env(safe-area-inset-top))" }}
          className="absolute right-4 inline-flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 transition hover:bg-white/70 hover:text-slate-600 dark:hover:bg-slate-800"
        >
          <Minimize2 size={20} />
        </button>

        <span
          className={`text-sm font-semibold uppercase tracking-widest ${
            isWork ? "text-trail-600 dark:text-trail-400" : "text-iris-500 dark:text-iris-300"
          }`}
        >
          {isWork ? "Focus" : "Break"}
        </span>

        <div
          className="relative flex items-center justify-center rounded-full"
          style={{
            width: "min(74vw, 20rem)",
            height: "min(74vw, 20rem)",
            background: `conic-gradient(${
              isWork ? "#4E8640" : "#B95530"
            } ${pct * 360}deg, rgb(226 224 220 / 0.6) 0deg)`,
          }}
          role="timer"
          aria-label={`${mmss(remaining)} remaining in ${isWork ? "focus" : "break"}`}
        >
          <div
            className="flex items-center justify-center rounded-full bg-white dark:bg-slate-900"
            style={{ width: "86%", height: "86%" }}
          >
            <span className="font-mono text-6xl font-semibold tabular-nums text-slate-800 dark:text-slate-100">
              {mmss(remaining)}
            </span>
          </div>
        </div>

        {goal.trim() || chosen.length ? (
          <div className="max-w-sm text-center">
            {goal.trim() ? (
              <p className="text-base font-medium text-slate-700 dark:text-slate-200">
                {goal.trim()}
              </p>
            ) : null}
            {chosen.length ? (
              <p className="mt-1 text-xs text-slate-400">
                {chosen.map((t) => t.title).join(" · ")}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="flex items-center gap-3">
          {running ? (
            <Button variant="subtle" onClick={pause}>
              <Pause size={16} /> Pause
            </Button>
          ) : (
            <Button onClick={start}>
              <Play size={16} /> {remaining < total ? "Resume" : "Start"}
            </Button>
          )}
          <Button variant="ghost" onClick={reset}>
            <RotateCcw size={16} /> End
          </Button>
          <Button variant="ghost" onClick={skip} aria-label="Skip to end of this phase">
            <SkipForward size={16} />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-800 dark:text-slate-100">
          <Timer size={20} className="text-trail-600 dark:text-trail-400" /> Focus
        </h2>
        {sessions > 0 ? (
          <Badge className="bg-trail-50 text-trail-700 dark:bg-slate-800 dark:text-trail-300">
            {sessions} block{sessions > 1 ? "s" : ""} today
          </Badge>
        ) : null}
      </div>

      {/* the clock */}
      <Card className="p-6">
        <div className="flex flex-col items-center">
          <span
            className={`mb-1 text-xs font-semibold uppercase tracking-wide ${
              isWork ? "text-trail-600 dark:text-trail-400" : "text-iris-500 dark:text-iris-300"
            }`}
          >
            {isWork ? "Focus" : "Break"}
          </span>
          <div
            className="relative flex h-44 w-44 items-center justify-center rounded-full"
            style={{
              background: `conic-gradient(${
                isWork ? "#4E8640" : "#B95530"
              } ${pct * 360}deg, rgb(226 224 220 / 0.6) 0deg)`,
            }}
            role="timer"
            aria-label={`${mmss(remaining)} remaining in ${isWork ? "focus" : "break"}`}
          >
            <div className="flex h-36 w-36 items-center justify-center rounded-full bg-white dark:bg-slate-900">
              <span className="font-mono text-4xl font-semibold tabular-nums text-slate-800 dark:text-slate-100">
                {mmss(remaining)}
              </span>
            </div>
          </div>

          <div className="mt-5 flex items-center gap-2">
            {running ? (
              <Button variant="subtle" onClick={pause}>
                <Pause size={16} /> Pause
              </Button>
            ) : (
              <Button onClick={start}>
                <Play size={16} /> {remaining < total ? "Resume" : "Start"}
              </Button>
            )}
            <Button variant="ghost" onClick={reset} aria-label="Reset timer">
              <RotateCcw size={16} />
            </Button>
            <Button variant="ghost" onClick={skip} aria-label="Skip to end of this phase">
              <SkipForward size={16} />
            </Button>
            {midBlock ? (
              <Button variant="ghost" onClick={() => setImmersive(true)} aria-label="Full screen">
                <Maximize2 size={16} />
              </Button>
            ) : null}
          </div>

          {/* length presets — only while idle, so a running block isn't yanked */}
          {!running ? (
            <div className="mt-4 flex items-center gap-1.5">
              {PRESETS.map(([w, b]) => {
                const active = w === workMin && b === breakMin;
                return (
                  <button
                    key={`${w}-${b}`}
                    onClick={() => {
                      setWorkMin(w);
                      setBreakMin(b);
                    }}
                    aria-pressed={active}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                      active
                        ? "bg-trail-100 text-trail-700 dark:bg-slate-800 dark:text-trail-300"
                        : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                    }`}
                  >
                    {w}/{b}
                  </button>
                );
              })}
            </div>
          ) : null}
          {note ? (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-trail-700 dark:text-trail-400">
              <Check size={13} /> {note}
            </p>
          ) : null}
        </div>
      </Card>

      {/* what this block is targeting */}
      <Card className="p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            This block is targeting
          </p>
          <Button
            variant="ghost"
            onClick={suggest}
            disabled={suggesting}
            className="!py-1 !px-2.5 text-xs"
          >
            <Sparkles size={13} /> {suggesting ? "Thinking…" : "Suggest a goal"}
          </Button>
        </div>
        <input
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="what do you want to get done this block?"
          aria-label="Focus block goal"
          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-trail-400 focus:outline-none focus:ring-2 focus:ring-trail-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-trail-800"
        />

        {targets.length ? (
          <div className="mt-3">
            <p className="mb-1.5 text-xs text-slate-400">
              Tag today's tasks & steps you'll work on:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {targets.map((t) => {
                const on = picked.has(t.id);
                return (
                  <button
                    key={`${t.kind}_${t.id}`}
                    onClick={() => togglePick(t.id)}
                    aria-pressed={on}
                    title={t.topic || undefined}
                    className={`inline-flex max-w-full items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                      on
                        ? "border-trail-400 bg-trail-50 text-trail-700 dark:bg-slate-800 dark:text-trail-300"
                        : "border-slate-300 text-slate-500 hover:border-trail-300 dark:border-slate-600 dark:text-slate-400"
                    }`}
                  >
                    {on ? <Check size={12} className="shrink-0" /> : null}
                    <span className="truncate">{t.title}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <p className="mt-3 text-xs text-slate-400">
            No open tasks or steps for today — type a goal above, or plan your day first.
          </p>
        )}
      </Card>

      <p className="flex items-start gap-1.5 px-1 text-xs text-slate-400">
        <Bell size={13} className="mt-0.5 shrink-0" />
        Enable notifications in Settings to get a push when a block ends, even with the app in the
        background.
      </p>
    </div>
  );
}
