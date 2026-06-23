import { useState } from "react";
import { Plus, Hammer, Github, Trash2, Rocket, Lightbulb, Circle, ArrowRight } from "lucide-react";
import {
  Card,
  Button,
  IconButton,
  Input,
  Field,
  Textarea,
  Modal,
  EmptyState,
  Badge,
} from "../ui.jsx";
import { uid } from "../lib/uid.js";
import { shortDate } from "../lib/format.js";
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

function ProjectCard({ p, ctx }) {
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
    await save((s) => {
      s.projects = s.projects.filter((x) => x.id !== p.id);
    });
    focusMainHeading();
  };

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-slate-800 dark:text-slate-100">{p.title}</h3>
          {p.summary ? <p className="mt-0.5 text-sm text-slate-500">{p.summary}</p> : null}
        </div>
        <IconButton label="Delete project" className="hover:text-rose-500" onClick={remove}>
          <Trash2 size={16} />
        </IconButton>
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

function NewProjectModal({ ctx, onClose }) {
  const { save, busy } = ctx;
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [status, setStatus] = useState("idea");

  const create = async () => {
    if (!title.trim()) {
      return;
    }
    await save((s) => {
      s.projects.push({
        id: uid("proj"),
        title: title.trim(),
        summary: summary.trim() || null,
        repoUrl: repoUrl.trim() || null,
        status,
        position: s.projects.length,
      });
    });
    onClose();
  };

  return (
    <Modal
      title="New project"
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
          placeholder="e.g. Build a tiny RTOS scheduler"
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
  const projects = ctx.state.projects || [];

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
            const group = projects.filter((p) => p.status === st);
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
                  {group.map((p) => (
                    <ProjectCard key={p.id} p={p} ctx={ctx} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {adding && <NewProjectModal ctx={ctx} onClose={() => setAdding(false)} />}
    </div>
  );
}
