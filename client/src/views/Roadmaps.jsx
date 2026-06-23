import { useState } from "react";
import {
  Plus,
  Check,
  Trash2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Map,
  ExternalLink,
  Archive,
  ArchiveRestore,
  Link2,
  Upload,
} from "lucide-react";
import {
  Card,
  Button,
  IconButton,
  Input,
  Field,
  Textarea,
  Modal,
  EmptyState,
  ProgressBar,
} from "../ui.jsx";
import { roadmapTree, nextPosition } from "../lib/tree.js";
import { parseRoadmap } from "../lib/parse.js";
import { uid } from "../lib/uid.js";

const COLORS = ["#10B981", "#0EA5E9", "#8B5CF6", "#F59E0B", "#F43F5E", "#64748B"];

/** Move the sibling `id` up (-1) or down (+1) and re-number positions contiguously. */
function reorder(siblings, id, dir) {
  const sorted = [...siblings].sort((a, b) => a.position - b.position);
  const i = sorted.findIndex((x) => x.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= sorted.length) {
    return;
  }
  [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
  sorted.forEach((x, idx) => (x.position = idx)); // mutates the shared state refs
}

/** Compact up/down reorder control. */
function MoveButtons({ canUp, canDown, onMove, busy }) {
  return (
    <span className="flex flex-col">
      <button
        disabled={busy || !canUp}
        onClick={() => onMove(-1)}
        aria-label="Move up"
        className="text-slate-300 hover:text-slate-600 disabled:opacity-30 dark:hover:text-slate-200"
      >
        <ChevronUp size={14} />
      </button>
      <button
        disabled={busy || !canDown}
        onClick={() => onMove(1)}
        aria-label="Move down"
        className="text-slate-300 hover:text-slate-600 disabled:opacity-30 dark:hover:text-slate-200"
      >
        <ChevronDown size={14} />
      </button>
    </span>
  );
}

function StepRow({ step, onDone, onDoing, onDelete, onMove, canUp, canDown, busy }) {
  const done = step.status === "done";
  const doing = step.status === "doing";
  return (
    <div className="group flex items-center gap-2 py-2">
      <button
        disabled={busy}
        onClick={() => onDone(step, !done)}
        aria-label={done ? "Mark not done" : "Mark done"}
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition ${
          done
            ? "border-trail-500 bg-trail-500 text-white"
            : "border-slate-300 text-transparent hover:border-trail-400 dark:border-slate-600"
        }`}
      >
        <Check size={12} strokeWidth={3} />
      </button>
      {/* tap the title to toggle "in progress" (touch-friendly, no hover needed) */}
      <button
        disabled={busy || done}
        onClick={() => onDoing(step, !doing)}
        className={`min-w-0 flex-1 truncate text-left text-sm ${
          done ? "text-slate-400 line-through" : "text-slate-700 dark:text-slate-200"
        }`}
      >
        {step.title}
        {doing ? <span className="ml-2 text-xs font-medium text-iris-500">in progress</span> : null}
      </button>
      {step.resourceUrl ? (
        <a
          href={step.resourceUrl}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 text-slate-400 hover:text-trail-600"
          aria-label="Open resource"
        >
          <ExternalLink size={14} />
        </a>
      ) : null}
      <MoveButtons canUp={canUp} canDown={canDown} onMove={onMove} busy={busy} />
      <button
        disabled={busy}
        onClick={() => onDelete(step)}
        aria-label="Delete step"
        className="shrink-0 text-slate-300 transition hover:text-rose-500"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

function AddInline({ placeholder, onAdd, busy }) {
  const [v, setV] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (v.trim()) {
          onAdd(v.trim());
          setV("");
        }
      }}
      className="flex items-center gap-2 pt-1"
    >
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder={placeholder}
        className="flex-1 rounded-lg border border-transparent bg-slate-100 px-2.5 py-1.5 text-sm placeholder:text-slate-400 focus:border-trail-300 focus:bg-white focus:outline-none dark:bg-slate-800 dark:focus:bg-slate-800"
      />
      <button
        type="submit"
        disabled={busy || !v.trim()}
        className="rounded-lg p-1.5 text-trail-600 hover:bg-trail-50 disabled:opacity-40 dark:hover:bg-slate-700"
        aria-label="Add"
      >
        <Plus size={16} />
      </button>
    </form>
  );
}

function RoadmapCard({ rm, ctx }) {
  const { save, complete, busy } = ctx;
  const [open, setOpen] = useState(rm.pct < 100 && rm.total > 0);

  // step done toggle uses the lean endpoint (stamps done_at server-side)
  const setDone = (step, done) => complete("step", step.id, done);

  const setDoing = (step, doing) =>
    save((s) => {
      const t = s.steps.find((x) => x.id === step.id);
      if (t) {
        t.status = doing ? "doing" : "todo";
        t.doneAt = null;
      }
    });

  const delStep = (step) =>
    save((s) => {
      s.steps = s.steps.filter((x) => x.id !== step.id);
    });

  const addStep = (milestoneId, title) =>
    save((s) => {
      s.steps.push({
        id: uid("step"),
        milestoneId,
        title,
        status: "todo",
        position: nextPosition(s.steps.filter((x) => x.milestoneId === milestoneId)),
      });
    });

  const addMilestone = (title) =>
    save((s) => {
      s.milestones.push({
        id: uid("ms"),
        roadmapId: rm.id,
        title,
        position: nextPosition(s.milestones.filter((m) => m.roadmapId === rm.id)),
      });
    });

  const moveStep = (milestoneId, stepId, dir) =>
    save((s) =>
      reorder(
        s.steps.filter((x) => x.milestoneId === milestoneId),
        stepId,
        dir,
      ),
    );

  const moveMilestone = (milestoneId, dir) =>
    save((s) =>
      reorder(
        s.milestones.filter((m) => m.roadmapId === rm.id),
        milestoneId,
        dir,
      ),
    );

  const toggleArchive = () =>
    save((s) => {
      const r = s.roadmaps.find((x) => x.id === rm.id);
      if (r) {
        r.archived = !r.archived;
      }
    });

  const remove = () =>
    save((s) => {
      s.roadmaps = s.roadmaps.filter((x) => x.id !== rm.id);
      const msIds = s.milestones.filter((m) => m.roadmapId === rm.id).map((m) => m.id);
      s.milestones = s.milestones.filter((m) => m.roadmapId !== rm.id);
      s.steps = s.steps.filter((x) => !msIds.includes(x.milestoneId));
    });

  return (
    <Card className={`overflow-hidden ${rm.archived ? "opacity-60" : ""}`}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span
          className="h-9 w-1.5 shrink-0 rounded-full"
          style={{ background: rm.color || "#10B981" }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-semibold text-slate-800 dark:text-slate-100">
              {rm.title}
            </h3>
            {rm.sourceUrl ? <Link2 size={13} className="shrink-0 text-slate-400" /> : null}
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <ProgressBar pct={rm.pct} color={rm.color} />
            <span className="shrink-0 text-xs font-medium text-slate-400">
              {rm.done}/{rm.total}
            </span>
          </div>
        </div>
        {open ? (
          <ChevronDown size={18} className="text-slate-400" />
        ) : (
          <ChevronRight size={18} className="text-slate-400" />
        )}
      </button>

      {open ? (
        <div className="border-t border-slate-100 px-4 py-3 dark:border-slate-800">
          {rm.sourceUrl ? (
            <a
              href={rm.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="mb-2 inline-flex items-center gap-1 text-xs text-trail-600 hover:underline"
            >
              <ExternalLink size={12} /> source roadmap
            </a>
          ) : null}

          {rm.milestones.length === 0 ? (
            <p className="py-1 text-sm text-slate-400">
              No milestones yet — add your first checkpoint below.
            </p>
          ) : (
            <div className="space-y-3">
              {rm.milestones.map((m, mi) => (
                <div key={m.id}>
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="min-w-0 truncate text-sm font-semibold text-slate-600 dark:text-slate-300">
                      {m.title}
                    </h4>
                    <div className="flex shrink-0 items-center gap-1">
                      <span className="text-xs text-slate-400">
                        {m.done}/{m.total}
                      </span>
                      <MoveButtons
                        canUp={mi > 0}
                        canDown={mi < rm.milestones.length - 1}
                        onMove={(dir) => moveMilestone(m.id, dir)}
                        busy={busy}
                      />
                    </div>
                  </div>
                  <div className="mt-0.5 divide-y divide-slate-100 dark:divide-slate-800">
                    {m.steps.map((st, si) => (
                      <StepRow
                        key={st.id}
                        step={st}
                        onDone={setDone}
                        onDoing={setDoing}
                        onDelete={delStep}
                        onMove={(dir) => moveStep(m.id, st.id, dir)}
                        canUp={si > 0}
                        canDown={si < m.steps.length - 1}
                        busy={busy}
                      />
                    ))}
                  </div>
                  <AddInline
                    placeholder="Add a step…"
                    onAdd={(t) => addStep(m.id, t)}
                    busy={busy}
                  />
                </div>
              ))}
            </div>
          )}

          <div className="mt-3 border-t border-dashed border-slate-200 pt-2 dark:border-slate-700">
            <AddInline placeholder="Add a milestone…" onAdd={addMilestone} busy={busy} />
          </div>

          <div className="mt-3 flex items-center justify-end gap-1">
            <IconButton label={rm.archived ? "Unarchive" : "Archive"} onClick={toggleArchive}>
              {rm.archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
            </IconButton>
            <IconButton label="Delete roadmap" className="hover:text-rose-500" onClick={remove}>
              <Trash2 size={16} />
            </IconButton>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function NewRoadmapModal({ ctx, onClose }) {
  const { save, busy } = ctx;
  const [title, setTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [color, setColor] = useState(COLORS[0]);

  const create = async () => {
    if (!title.trim()) {
      return;
    }
    await save((s) => {
      s.roadmaps.push({
        id: uid("rm"),
        title: title.trim(),
        sourceUrl: sourceUrl.trim() || null,
        color,
        archived: false,
        position: nextPosition(s.roadmaps),
      });
    });
    onClose();
  };

  return (
    <Modal
      title="New roadmap"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={create} disabled={busy || !title.trim()}>
            Create
          </Button>
        </>
      }
    >
      <Field label="Title">
        <Input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Bare-metal embedded"
          onKeyDown={(e) => e.key === "Enter" && create()}
        />
      </Field>
      <Field label="Source link" hint="Optional — a roadmap.sh track, a GitHub repo, a course…">
        <Input
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          placeholder="https://roadmap.sh/…"
        />
      </Field>
      <Field label="Color">
        <div className="flex gap-2">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              aria-label={`color ${c}`}
              className={`h-8 w-8 rounded-full ring-2 ring-offset-2 transition dark:ring-offset-slate-900 ${
                color === c ? "ring-slate-400" : "ring-transparent"
              }`}
              style={{ background: c }}
            />
          ))}
        </div>
      </Field>
    </Modal>
  );
}

function ImportRoadmapModal({ ctx, onClose }) {
  const { save, busy } = ctx;
  const [title, setTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [md, setMd] = useState("");

  const parsed = parseRoadmap(md, { title });

  const create = async () => {
    if (!md.trim() || parsed.stepCount === 0) {
      return;
    }
    const ok = await save((s) => {
      const rmId = uid("rm");
      s.roadmaps.push({
        id: rmId,
        title: parsed.title,
        sourceUrl: sourceUrl.trim() || null,
        color,
        archived: false,
        position: nextPosition(s.roadmaps),
      });
      parsed.milestones.forEach((m, mi) => {
        const msId = uid("ms");
        s.milestones.push({ id: msId, roadmapId: rmId, title: m.title, position: mi });
        m.steps.forEach((st, si) => {
          s.steps.push({
            id: uid("step"),
            milestoneId: msId,
            title: st.title,
            status: st.status,
            resourceUrl: st.resourceUrl || null,
            position: si,
          });
        });
      });
    });
    if (ok !== false) {
      onClose();
    }
  };

  return (
    <Modal
      title="Import a roadmap"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={create} disabled={busy || parsed.stepCount === 0}>
            Import {parsed.stepCount ? `${parsed.stepCount} steps` : ""}
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-500">
        Paste Markdown — a roadmap.sh export, a GitHub roadmap README, course notes.
        <span className="text-slate-400">
          {" "}
          Headings become milestones, list items become steps, <code>- [x]</code> marks done, and{" "}
          <code>[text](link)</code> attaches a resource.
        </span>
      </p>
      <Field label="Markdown">
        <Textarea
          rows={8}
          value={md}
          onChange={(e) => setMd(e.target.value)}
          placeholder={
            "## Fundamentals\n- [Intro to GPIO](https://…)\n- [ ] UART\n\n## Peripherals\n- SPI\n- I2C"
          }
        />
      </Field>
      <div className="flex gap-3">
        <Field label="Title" hint="Defaults to the first # heading.">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={parsed.title}
          />
        </Field>
        <Field label="Source link">
          <Input
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="https://roadmap.sh/…"
          />
        </Field>
      </div>
      <Field label="Color">
        <div className="flex gap-2">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              aria-label={`color ${c}`}
              className={`h-8 w-8 rounded-full ring-2 ring-offset-2 transition dark:ring-offset-slate-900 ${
                color === c ? "ring-slate-400" : "ring-transparent"
              }`}
              style={{ background: c }}
            />
          ))}
        </div>
      </Field>
      {md.trim() ? (
        <div className="rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
          {parsed.stepCount ? (
            <>
              <p className="font-medium text-slate-700 dark:text-slate-200">
                Preview: {parsed.title}
              </p>
              <ul className="mt-1 space-y-0.5 text-slate-500">
                {parsed.milestones.map((m, i) => (
                  <li key={i}>
                    <span className="text-trail-600">{m.title}</span> — {m.steps.length} steps
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-slate-400">
              No steps found yet — add some headings and list items above.
            </p>
          )}
        </div>
      ) : null}
    </Modal>
  );
}

export default function Roadmaps({ ctx }) {
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const tree = roadmapTree(ctx.state);
  const active = tree.filter((r) => !r.archived);
  const archived = tree.filter((r) => r.archived);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Roadmaps</h2>
        <div className="flex gap-2">
          <Button variant="subtle" onClick={() => setImporting(true)}>
            <Upload size={16} /> Import
          </Button>
          <Button onClick={() => setAdding(true)}>
            <Plus size={16} /> New
          </Button>
        </div>
      </div>

      {tree.length === 0 ? (
        <EmptyState
          icon={Map}
          title="No roadmaps yet"
          action={
            <div className="flex gap-2">
              <Button variant="subtle" onClick={() => setImporting(true)}>
                <Upload size={16} /> Import Markdown
              </Button>
              <Button onClick={() => setAdding(true)}>
                <Plus size={16} /> New roadmap
              </Button>
            </div>
          }
        >
          Drop in a learning path — a roadmap.sh track, a GitHub roadmap, a book — and break it into
          milestones and steps. Michi will surface the next step each day.
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {active.map((rm) => (
            <RoadmapCard key={rm.id} rm={rm} ctx={ctx} />
          ))}
          {archived.length ? (
            <div className="pt-2">
              <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Archived
              </p>
              <div className="space-y-3">
                {archived.map((rm) => (
                  <RoadmapCard key={rm.id} rm={rm} ctx={ctx} />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}

      {adding && <NewRoadmapModal ctx={ctx} onClose={() => setAdding(false)} />}
      {importing && <ImportRoadmapModal ctx={ctx} onClose={() => setImporting(false)} />}
    </div>
  );
}
