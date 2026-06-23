import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Modal, Button, Field, Input, Select } from "../ui.jsx";
import { roadmapTree } from "../lib/tree.js";
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

  const tree = roadmapTree(state);
  const projects = state.projects || [];

  const fields = () => ({
    title: title.trim(),
    due: due || null,
    recurrence: recurrence || null,
    estMin: estMin === "" ? null : Number(estMin),
    stepId: stepId || null,
    projectId: projectId || null,
  });

  const submit = async () => {
    if (!title.trim()) {
      return;
    }
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
    if (ok !== false) {
      onClose();
    }
  };

  const remove = async () => {
    const ok = await save((s) => {
      s.tasks = s.tasks.filter((x) => x.id !== task.id);
    });
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
            <Button
              variant="ghost"
              className="mr-auto text-rose-500"
              onClick={remove}
              disabled={busy}
            >
              <Trash2 size={15} /> Delete
            </Button>
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
