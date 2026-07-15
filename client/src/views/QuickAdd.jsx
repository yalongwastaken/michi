import { useEffect, useRef, useState } from "react";
import { Plus, SlidersHorizontal, Check } from "lucide-react";
import { Modal, Button, Input, IconButton } from "../ui.jsx";
import { parseQuickAdd } from "../lib/quickadd.js";
import { parseQuickLog, minLabel, durLabel } from "../lib/quicklog.js";
import { uid } from "../lib/uid.js";
import { api } from "../lib/api.js";
import TaskModal from "./TaskModal.jsx";

/**
 * The always-available fast add, opened by the global + button. A Task/Log toggle:
 *   Task → an autofocused NL task ("read SPI 30m tomorrow"), or hand off to details.
 *   Log  → an NL time-log for today ("studied SPI 9-11"), placed on the journal.
 * Either way it stays open after each add so you can rattle off a few, then dismiss.
 */
export default function QuickAdd({ ctx, onClose }) {
  const { addTask, busy, day, refresh } = ctx;
  const [mode, setMode] = useState("task");
  const [text, setText] = useState("");
  const [added, setAdded] = useState(0); // count this session — drives the "added ✓" line
  const [lastLog, setLastLog] = useState(null); // a tiny confirmation of the parsed time
  const [details, setDetails] = useState(false);
  const [logBusy, setLogBusy] = useState(false);
  const inputRef = useRef(null);
  const submitting = useRef(false);

  // grab focus after the Modal's own focus() runs, so the keyboard opens straight away
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [mode]);

  const addTaskEntry = async () => {
    const p = parseQuickAdd(text, { today: day });
    const ok = await addTask({
      id: uid("task"),
      status: "todo",
      title: p.title || text.trim(),
      due: p.due || (p.recurrence ? null : day),
      estMin: p.estMin ?? null,
      recurrence: p.recurrence ?? null,
    });
    return ok !== false;
  };

  const addLogEntry = async () => {
    const p = parseQuickLog(text);
    setLogBusy(true);
    try {
      await api.journal.add({
        day,
        title: p.title || text.trim(),
        startMin: p.startMin,
        endMin: p.endMin,
      });
      setLastLog(p);
      await refresh?.(); // so the Journal tab / Home reflect it if open
      setLogBusy(false);
      return true;
    } catch {
      setLogBusy(false);
      return false;
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (submitting.current || !text.trim()) {
      return;
    }
    submitting.current = true;
    const ok = mode === "log" ? await addLogEntry() : await addTaskEntry();
    submitting.current = false;
    if (ok) {
      setText("");
      setAdded((n) => n + 1);
      inputRef.current?.focus(); // keep going — add the next one without a tap
    }
  };

  if (details) {
    // hand off to the full editor; closing it returns to a clean slate
    return <TaskModal ctx={ctx} onClose={onClose} />;
  }

  const isLog = mode === "log";
  const switchMode = (m) => {
    setMode(m);
    setText("");
    setAdded(0);
    setLastLog(null);
  };

  return (
    <Modal title="Quick add" onClose={onClose}>
      <div
        role="tablist"
        aria-label="What to add"
        className="flex gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800/70"
      >
        {[
          ["task", "Task"],
          ["log", "Log time"],
        ].map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={mode === id}
            onClick={() => switchMode(id)}
            className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              mode === id
                ? "bg-white text-trail-700 shadow-sm dark:bg-slate-900 dark:text-trail-400"
                : "text-slate-500 dark:text-slate-400"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="mt-3 flex gap-2">
        <Input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={isLog ? "e.g. “studied SPI 9-11”" : "e.g. “read SPI 30m tomorrow”"}
          aria-label={isLog ? "Log an entry" : "New task"}
        />
        {isLog ? null : (
          <IconButton
            label="Add with details"
            type="button"
            onClick={() => setDetails(true)}
            className="shrink-0 border border-slate-300 dark:border-slate-600"
          >
            <SlidersHorizontal size={16} />
          </IconButton>
        )}
        <Button
          type="submit"
          disabled={busy || logBusy || !text.trim()}
          aria-label={isLog ? "Log entry" : "Add task"}
        >
          <Plus size={16} />
        </Button>
      </form>

      <p className="mt-2 text-xs text-slate-400">
        {isLog ? (
          <>
            Say what you did and when — <span className="font-medium">9-11</span>,{" "}
            <span className="font-medium">2pm-3:30</span>, or a length like{" "}
            <span className="font-medium">90m</span>. It lands on today's journal.
          </>
        ) : (
          <>
            Type it how you'd say it — a time like <span className="font-medium">30m</span> and a
            day like <span className="font-medium">tomorrow</span> or{" "}
            <span className="font-medium">fri</span> are picked up automatically.
          </>
        )}
      </p>

      {added > 0 ? (
        <p
          role="status"
          className="mt-1 flex items-center gap-1.5 text-xs font-medium text-trail-700 dark:text-trail-400"
        >
          <Check size={13} />
          {isLog
            ? lastLog && lastLog.startMin != null
              ? `Logged ${minLabel(lastLog.startMin)}${lastLog.endMin != null ? `–${minLabel(lastLog.endMin)}` : ""} — keep going.`
              : lastLog && lastLog.minutes
                ? `Logged ${durLabel(lastLog.minutes)} — keep going.`
                : `Logged ${added} — keep going, or close when you're done.`
            : `Added ${added} — keep going, or close when you're done.`}
        </p>
      ) : null}
    </Modal>
  );
}
