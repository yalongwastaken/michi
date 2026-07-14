import { useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { Modal, Button, ConfirmButton, Field, Input, Select, Textarea } from "../ui.jsx";
import { roadmapTree } from "../lib/tree.js";
import { deleteTask } from "../lib/mutate.js";
import { uid } from "../lib/uid.js";

const RECURRENCES = [
  { value: "", label: "One-off" },
  { value: "daily", label: "Every day" },
  { value: "weekdays", label: "Weekdays (Mon–Fri)" },
  { value: "weekly", label: "Weekly" },
];

/**
 * Add or edit a task. Pass `task` to edit (else it's a new task). New tasks go
 * through the lean addTask endpoint; edits and deletes go through a full-state save.
 */
export default function TaskModal({ ctx, task = null, onClose }) {
  const editing = !!task;
  const { state, addTask, save, busy } = ctx;

  const [title, setTitle] = useState(task?.title || "");
  const [due, setDue] = useState(task?.due || (editing ? "" : ctx.day));
  const [recurrence, setRecurrence] = useState(task?.recurrence || "");
  const [estMin, setEstMin] = useState(task?.estMin != null ? String(task.estMin) : "");
  const [stepId, setStepId] = useState(task?.stepId || "");
  const [projectId, setProjectId] = useState(task?.projectId || "");
  const [notes, setNotes] = useState(task?.notes || "");

  const tree = roadmapTree(state);
  const projects = state.projects || [];

  const fields = () => ({
    title: title.trim(),
    due: due || null,
    recurrence: recurrence || null,
    estMin: estMin === "" ? null : Number(estMin),
    stepId: stepId || null,
    projectId: projectId || null,
    notes: notes.trim() || null,
  });

  const submitting = useRef(false); // Enter + click (or two quick Enters) → one submit
  const submit = async () => {
    if (submitting.current || !title.trim()) {
      return;
    }
    submitting.current = true;
    let ok;
    if (editing) {
      ok = await save((s) => {
        const t = s.tasks.find((x) => x.id === task.id);
        if (t) {
          Object.assign(t, fields());
        }
      });
    } else {
      ok = await addTask({ id: uid("task"), status: "todo", ...fields() });
    }
    submitting.current = false;
    if (ok !== false) {
      onClose();
    }
  };

  const remove = async () => {
    // save() itself offers the undo toast from the PUT's trash receipt
    const ok = await save((s) => deleteTask(s, task.id));
    if (ok !== false) {
      onClose();
    }
  };

  return (
    <Modal
      title={editing ? "Edit task" : "New task"}
      onClose={onClose}
      footer={
        <>
          {editing ? (
            <ConfirmButton
              label="Delete task"
              confirm="Really delete?"
              onConfirm={remove}
              disabled={busy}
              className="mr-auto h-9 px-2"
            >
              <Trash2 size={15} /> Delete
            </ConfirmButton>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !title.trim()}>
            {editing ? "Save" : "Add"}
          </Button>
        </>
      }
    >
      <Field label="Title">
        <Input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Finish the UART driver"
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
      </Field>

      <div className="flex gap-3">
        <Field label="Due">
          <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
        <Field label="Estimate (min)">
          <Input
            type="number"
            min="0"
            step="5"
            value={estMin}
            onChange={(e) => setEstMin(e.target.value)}
            placeholder="—"
          />
        </Field>
      </div>

      <Field label="Repeat" hint="Recurring tasks reappear on their cadence and build your streak.">
        <Select value={recurrence} onChange={(e) => setRecurrence(e.target.value)}>
          {RECURRENCES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Link to a step" hint="Optional — tie this task to a roadmap step.">
        <Select value={stepId} onChange={(e) => setStepId(e.target.value)}>
          <option value="">None</option>
          {tree.map((rm) => (
            <optgroup key={rm.id} label={rm.title}>
              {rm.milestones.flatMap((m) =>
                m.steps.map((s) => (
                  <option key={s.id} value={s.id}>
                    {m.title} · {s.title}
                  </option>
                )),
              )}
            </optgroup>
          ))}
        </Select>
      </Field>

      <Field label="Notes">
        <Textarea
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="anything future-you should know…"
        />
      </Field>

      {projects.length ? (
        <Field label="Link to a project">
          <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">None</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
    </Modal>
  );
}
