import { useEffect, useRef, useState } from "react";
import { Plus, SlidersHorizontal, Check } from "lucide-react";
import { Modal, Button, Input, IconButton } from "../ui.jsx";
import { parseQuickAdd } from "../lib/quickadd.js";
import { uid } from "../lib/uid.js";
import TaskModal from "./TaskModal.jsx";

/**
 * The always-available fast add, opened by the global + button. One autofocused
 * field with natural-language parsing ("read SPI 30m tomorrow"); stays open after
 * each add so you can rattle off a few, then dismiss. "Details" hands off to the
 * full TaskModal for the rare time you want every field.
 */
export default function QuickAdd({ ctx, onClose }) {
  const { addTask, busy, day } = ctx;
  const [text, setText] = useState("");
  const [added, setAdded] = useState(0); // count this session — drives the "added ✓" line
  const [details, setDetails] = useState(false);
  const inputRef = useRef(null);
  const submitting = useRef(false);

  // grab focus after the Modal's own focus() runs, so the keyboard opens straight away
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (submitting.current || !text.trim()) {
      return;
    }
    const p = parseQuickAdd(text, { today: day });
    submitting.current = true;
    const ok = await addTask({
      id: uid("task"),
      status: "todo",
      title: p.title || text.trim(),
      due: p.due || (p.recurrence ? null : day),
      estMin: p.estMin ?? null,
      recurrence: p.recurrence ?? null,
    });
    submitting.current = false;
    if (ok !== false) {
      setText("");
      setAdded((n) => n + 1);
      inputRef.current?.focus(); // keep going — add the next one without a tap
    }
  };

  if (details) {
    // hand off to the full editor; closing it returns to a clean slate
    return <TaskModal ctx={ctx} onClose={onClose} />;
  }

  return (
    <Modal title="Quick add" onClose={onClose}>
      <form onSubmit={submit} className="flex gap-2">
        <Input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. “read SPI 30m tomorrow”"
          aria-label="New task"
        />
        <IconButton
          label="Add with details"
          type="button"
          onClick={() => setDetails(true)}
          className="shrink-0 border border-slate-300 dark:border-slate-600"
        >
          <SlidersHorizontal size={16} />
        </IconButton>
        <Button type="submit" disabled={busy || !text.trim()} aria-label="Add task">
          <Plus size={16} />
        </Button>
      </form>
      <p className="mt-2 text-xs text-slate-400">
        Type it how you'd say it — a time like <span className="font-medium">30m</span> and a day
        like <span className="font-medium">tomorrow</span> or{" "}
        <span className="font-medium">fri</span> are picked up automatically.
      </p>
      {added > 0 ? (
        <p
          role="status"
          className="mt-1 flex items-center gap-1.5 text-xs font-medium text-trail-700 dark:text-trail-400"
        >
          <Check size={13} /> Added {added} — keep going, or close when you're done.
        </p>
      ) : null}
    </Modal>
  );
}
