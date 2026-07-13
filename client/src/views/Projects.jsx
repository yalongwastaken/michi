import { useRef, useState } from "react";
import {
  Plus,
  Hammer,
  Github,
  Trash2,
  Rocket,
  Lightbulb,
  Circle,
  ArrowRight,
  Pencil,
  Map as MapIcon,
} from "lucide-react";
import {
  Card,
  Button,
  ConfirmButton,
  IconButton,
  Input,
  Field,
  Textarea,
  Select,
  Modal,
  EmptyState,
  Badge,
  MoveButtons,
} from "../ui.jsx";
import { uid } from "../lib/uid.js";
import { shortDate } from "../lib/format.js";
import { roadmapTree, reorder, nextPosition } from "../lib/tree.js";
import { deleteProject } from "../lib/mutate.js";
import { focusMainHeading } from "../lib/a11y.js";

const FLOW = ["idea", "active", "shipped"];
const META = {
  idea: {
    label: "Ideas",
    icon: Lightbulb,
    tint: "text-iris-600",
    chip: "bg-iris-50 text-iris-600 dark:bg-iris-950/40",
  },
  active: {
    label: "In progress",
    icon: Circle,
    tint: "text-trail-600",
    chip: "bg-trail-50 text-trail-700 dark:bg-slate-800 dark:text-trail-300",
  },
  shipped: {
    label: "Shipped",
    icon: Rocket,
    tint: "text-sky-600",
    chip: "bg-sky-50 text-sky-600 dark:bg-sky-950/40",
  },
};

function ProjectCard({ p, ctx, roadmap, onEdit, onMove, canUp, canDown }) {
  const { save, busy } = ctx;
  const idx = FLOW.indexOf(p.status);
  const nextStatus = FLOW[idx + 1];

  const advance = () =>
    save((s) => {
      const t = s.projects.find((x) => x.id === p.id);
      if (t && nextStatus) {
        t.status = nextStatus;
        t.shippedAt = nextStatus === "shipped" ? new Date().toISOString() : null;
      }
    });

  const remove = async () => {
    // deleteProject also unlinks tasks pointing here (dangling refs 400 the PUT)
    const ok = await save((s) => deleteProject(s, p.id));
    focusMainHeading();
    if (ok !== false) {
      ctx.notifyDeleted?.("project", p.title); // the undo toast's cue
    }
  };

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-slate-800 dark:text-slate-100">{p.title}</h3>
          {p.summary ? <p className="mt-0.5 text-sm text-slate-500">{p.summary}</p> : null}
        </div>
        <div className="flex shrink-0 items-center">
          <MoveButtons canUp={canUp} canDown={canDown} onMove={onMove} busy={busy} />
          <IconButton label="Edit project" className="h-9 w-9" onClick={onEdit}>
            <Pencil size={15} />
          </IconButton>
          <ConfirmButton label="Delete project" onConfirm={remove} className="h-9 min-w-9">
            <Trash2 size={16} />
          </ConfirmButton>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {p.repoUrl ? (
          <a
            href={p.repoUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-xs text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
          >
            <Github size={13} /> repo
          </a>
        ) : null}
        {roadmap ? (
          // the paired learning path — tap to jump to the Roadmaps tab
          <button
            onClick={() => ctx.setTab?.("roadmaps")}
            aria-label={`Open roadmap ${roadmap.title} — ${roadmap.pct}% complete`}
            className="inline-flex max-w-[14rem] items-center gap-1 rounded-lg bg-trail-50 px-2 py-1 text-xs text-trail-700 hover:bg-trail-100 dark:bg-slate-800 dark:text-trail-300 dark:hover:bg-slate-700"
          >
            <MapIcon size={12} className="shrink-0" />
            <span className="truncate">{roadmap.title}</span>
            <span className="shrink-0 font-semibold">{roadmap.pct}%</span>
          </button>
        ) : null}
        {p.shippedAt ? (
          <Badge className={META.shipped.chip}>shipped {shortDate(p.shippedAt)}</Badge>
        ) : null}
        {nextStatus ? (
          <Button
            variant="subtle"
            disabled={busy}
            onClick={advance}
            className="ml-auto !py-1 !px-2.5 text-xs"
          >
            {nextStatus === "active" ? "Start" : "Mark shipped"} <ArrowRight size={13} />
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

/** Create or edit a project — pass `project` to edit. */
function ProjectModal({ ctx, project = null, onClose }) {
  const { state, save, busy } = ctx;
  const editing = !!project;
  const [title, setTitle] = useState(project?.title || "");
  const [summary, setSummary] = useState(project?.summary || "");
  const [repoUrl, setRepoUrl] = useState(project?.repoUrl || "");
  const [status, setStatus] = useState(project?.status || "idea");
  const [roadmapId, setRoadmapId] = useState(project?.roadmapId || "");
  const roadmaps = state.roadmaps || [];

  const submitting = useRef(false); // Enter + click (or two quick Enters) → one commit
  const commit = async () => {
    if (submitting.current || !title.trim()) {
      return;
    }
    const fields = {
      title: title.trim(),
      summary: summary.trim() || null,
      repoUrl: repoUrl.trim() || null,
      status,
      roadmapId: roadmapId || null,
    };
    submitting.current = true;
    const ok = await save((s) => {
      if (editing) {
        const t = s.projects.find((x) => x.id === project.id);
        if (t) {
          Object.assign(t, fields);
        }
      } else {
        s.projects.push({
          id: uid("proj"),
          position: nextPosition(s.projects),
          ...fields,
        });
      }
    });
    submitting.current = false;
    if (ok !== false) {
      onClose(); // a failed save keeps the modal (and the input) around for retry
    }
  };

  return (
    <Modal
      title={editing ? "Edit project" : "New project"}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={commit} disabled={busy || !title.trim()}>
            {editing ? "Save" : "Create"}
          </Button>
        </>
      }
    >
      <Field label="Title">
        <Input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Build a tiny RTOS scheduler"
          onKeyDown={(e) => e.key === "Enter" && commit()}
        />
      </Field>
      <Field label="What is it?" hint="Optional one-liner — why it's meaningful to you.">
        <Textarea value={summary} onChange={(e) => setSummary(e.target.value)} />
      </Field>
      <Field label="Repo / link">
        <Input
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          placeholder="https://github.com/…"
        />
      </Field>
      {roadmaps.length ? (
        <Field label="Linked roadmap" hint="The learning path this project puts into practice.">
          <Select value={roadmapId} onChange={(e) => setRoadmapId(e.target.value)}>
            <option value="">— none —</option>
            {roadmaps.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <Field label="Stage">
        <div className="flex gap-2">
          {FLOW.map((st) => (
            <button
              key={st}
              onClick={() => setStatus(st)}
              className={`flex-1 rounded-xl border px-3 py-2 text-sm capitalize transition ${
                status === st
                  ? "border-trail-400 bg-trail-50 text-trail-700 dark:bg-slate-800 dark:text-trail-300"
                  : "border-slate-300 text-slate-500 dark:border-slate-600"
              }`}
            >
              {st}
            </button>
          ))}
        </div>
      </Field>
    </Modal>
  );
}

export default function Projects({ ctx }) {
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState(null);
  const projects = ctx.state.projects || [];
  // roadmap progress for the linked-roadmap chips, keyed by id
  const rmById = new Map(roadmapTree(ctx.state).map((r) => [r.id, r]));
  // edit the latest version of the project (state may have refreshed underneath)
  const editing = editId ? projects.find((p) => p.id === editId) : null;

  // reorder within the project's stage group — that's the visible list order
  const moveProject = (p, dir) =>
    ctx.save((s) =>
      reorder(
        s.projects.filter((x) => x.status === p.status),
        p.id,
        dir,
      ),
    );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Projects</h2>
        <Button onClick={() => setAdding(true)}>
          <Plus size={16} /> New
        </Button>
      </div>

      {projects.length === 0 ? (
        <EmptyState
          icon={Hammer}
          title="Nothing on the workbench"
          action={
            <Button onClick={() => setAdding(true)}>
              <Plus size={16} /> Add a project
            </Button>
          }
        >
          Learning sticks when you build. Capture the things you want to ship — and move them from
          idea to shipped as you go.
        </EmptyState>
      ) : (
        <div className="space-y-5">
          {FLOW.map((st) => {
            const group = projects
              .filter((p) => p.status === st)
              .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
            if (!group.length) {
              return null;
            }
            const { label, icon: Icon, tint } = META[st];
            return (
              <div key={st}>
                <div
                  className={`mb-1.5 flex items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wide ${tint}`}
                >
                  <Icon size={13} /> {label}{" "}
                  <span className="text-slate-300">· {group.length}</span>
                </div>
                <div className="space-y-2.5">
                  {group.map((p, i) => (
                    <ProjectCard
                      key={p.id}
                      p={p}
                      ctx={ctx}
                      roadmap={p.roadmapId ? rmById.get(p.roadmapId) : null}
                      onEdit={() => setEditId(p.id)}
                      onMove={(dir) => moveProject(p, dir)}
                      canUp={i > 0}
                      canDown={i < group.length - 1}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {adding && <ProjectModal ctx={ctx} onClose={() => setAdding(false)} />}
      {editing && <ProjectModal ctx={ctx} project={editing} onClose={() => setEditId(null)} />}
    </div>
  );
}
