import { useEffect, useRef, useState } from "react";
import {
  Plus,
  Check,
  Trash2,
  ChevronDown,
  ChevronRight,
  Map,
  ExternalLink,
  Archive,
  ArchiveRestore,
  Link2,
  Upload,
  Pencil,
  CalendarClock,
  StickyNote,
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
  ProgressBar,
  MoveButtons,
} from "../ui.jsx";
import { roadmapTree, nextPosition, reorder } from "../lib/tree.js";
import { deleteRoadmap, deleteStep } from "../lib/mutate.js";
import { parseRoadmap } from "../lib/parse.js";
import { shortDate } from "../lib/format.js";
import { focusMainHeading } from "../lib/a11y.js";
import { uid } from "../lib/uid.js";
import { checkRituals, confettiBurst } from "../lib/celebrate.js";
import Mascot from "./Mascot.jsx";
import Celebration from "./Celebration.jsx";

const STEP_MINUTE_OPTS = [
  ["", "default"],
  ["15", "15 min"],
  ["30", "30 min"],
  ["45", "45 min"],
  ["60", "1 hour"],
];

const COLORS = ["#4E8640", "#0EA5E9", "#B95530", "#F59E0B", "#F43F5E", "#74706A"];

function StepRow({ step, onDone, onDoing, onDelete, onSaveNote, onMove, canUp, canDown, busy }) {
  const done = step.status === "done";
  const doing = step.status === "doing";
  const hasNote = !!(step.notes && step.notes.trim());
  // note panel: closed → read-only → editing. A row without a note jumps straight
  // to the textarea, so the same tiny glyph is both "view note" and "add note".
  const [noteOpen, setNoteOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const submitting = useRef(false); // blocks a double tap from saving twice

  const toggleNote = () => {
    if (noteOpen) {
      setNoteOpen(false);
      setEditing(false);
      return;
    }
    setDraft(step.notes || "");
    setEditing(!hasNote);
    setNoteOpen(true);
  };

  const saveNote = async () => {
    if (submitting.current) {
      return;
    }
    submitting.current = true;
    const ok = await onSaveNote(step, draft.trim() || null);
    submitting.current = false;
    if (ok !== false) {
      setNoteOpen(false);
      setEditing(false);
    }
  };

  return (
    <div>
      <div className="group flex items-center gap-2 py-2">
        {/* no busy gate on the status toggles: they're optimistic and the write queue
            serializes, so working through a milestone shouldn't be tap-wait-tap-wait */}
        <button
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
          disabled={done}
          onClick={() => onDoing(step, !doing)}
          className={`min-w-0 flex-1 truncate text-left text-sm ${
            done ? "text-slate-400 line-through" : "text-slate-700 dark:text-slate-200"
          }`}
        >
          {step.title}
          {doing ? (
            <span className="ml-2 text-xs font-medium text-iris-500 dark:text-iris-300">
              in progress
            </span>
          ) : null}
        </button>
        {step.resourceUrl ? (
          <a
            href={step.resourceUrl}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 p-1 text-slate-400 hover:text-trail-700 dark:hover:text-trail-400"
            aria-label="Open resource"
          >
            <ExternalLink size={14} />
          </a>
        ) : null}
        {/* faint when empty (the "add note" spot), iris when a note is waiting */}
        <button
          onClick={toggleNote}
          aria-label={hasNote ? "View note" : "Add note"}
          aria-expanded={noteOpen}
          className={`shrink-0 p-1 transition ${
            hasNote
              ? "text-iris-500 hover:text-iris-600 dark:text-iris-300 dark:hover:text-iris-200"
              : "text-slate-300 hover:text-slate-500 dark:text-slate-600 dark:hover:text-slate-400"
          }`}
        >
          <StickyNote size={14} />
        </button>
        <MoveButtons canUp={canUp} canDown={canDown} onMove={onMove} busy={busy} />
        <ConfirmButton
          label="Delete step"
          onConfirm={() => onDelete(step)}
          disabled={busy}
          className="h-7 min-w-7 shrink-0"
        >
          <Trash2 size={14} />
        </ConfirmButton>
      </div>
      {noteOpen ? (
        <div className="mb-2 ml-7 rounded-lg bg-slate-50 p-2 dark:bg-slate-800/60">
          {editing ? (
            <div className="space-y-1.5">
              <textarea
                rows={2}
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="anything future-you should know…"
                aria-label="Step note"
                className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800 placeholder:text-slate-400 focus:border-trail-400 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              />
              <div className="flex justify-end gap-1">
                <Button variant="ghost" onClick={toggleNote} className="!px-2.5 !py-1 text-xs">
                  Cancel
                </Button>
                <Button onClick={saveNote} disabled={busy} className="!px-2.5 !py-1 text-xs">
                  Save note
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2">
              <p className="min-w-0 flex-1 whitespace-pre-wrap text-xs text-slate-600 dark:text-slate-300">
                {step.notes}
              </p>
              <button
                onClick={() => {
                  setDraft(step.notes || "");
                  setEditing(true);
                }}
                className="shrink-0 text-xs font-medium text-trail-700 hover:underline dark:text-trail-400"
              >
                Edit
              </button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function AddInline({ placeholder, onAdd, busy }) {
  const [v, setV] = useState("");
  const submitting = useRef(false); // blocks a double Enter from adding twice
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const title = v.trim();
        if (!title || submitting.current) {
          return;
        }
        submitting.current = true;
        const ok = await onAdd(title);
        submitting.current = false;
        if (ok !== false) {
          setV(""); // only on success — a failed add keeps the text for retry
        }
      }}
      className="flex items-center gap-2 pt-1"
    >
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="flex-1 rounded-lg border border-transparent bg-slate-100 px-2.5 py-1.5 text-sm placeholder:text-slate-400 focus:border-trail-300 focus:bg-white focus:outline-none dark:bg-slate-800 dark:focus:bg-slate-800"
      />
      <button
        type="submit"
        disabled={busy || !v.trim()}
        className="rounded-lg p-1.5 text-trail-700 hover:bg-trail-50 disabled:opacity-40 dark:text-trail-400 dark:hover:bg-slate-700"
        aria-label="Add"
      >
        <Plus size={16} />
      </button>
    </form>
  );
}

// NOTE: duplicates the server's pacing math (insights.js deadline nudges, the
// planner's "pace" picks) — the dashboard payload carries no per-roadmap pacing,
// so it's recomputed here. Keep the day-count and rounding in sync if either changes.
function deadlineInfo(rm, today) {
  if (!rm.targetDate) {
    return null;
  }
  const daysLeft = Math.max(
    1,
    Math.round(
      (Date.parse(`${rm.targetDate}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000,
    ) + 1,
  );
  const remaining = rm.total - rm.done;
  const overdue = Date.parse(`${rm.targetDate}T12:00:00Z`) < Date.parse(`${today}T12:00:00Z`);
  const perDay = remaining > 0 ? Math.ceil(remaining / daysLeft) : 0;
  return { daysLeft, remaining, perDay, overdue, done: remaining <= 0 };
}

// ── winding path view ──────────────────────────────────────────────────────────
// The roadmap as a trail: steps climb bottom→top in walk order, so the frontier
// (first unfinished step) is where you're standing and everything done sits below.
// Geometry: rows (gates + steps) sit at y = H − pad − i·rowH; x alternates across
// the center via sin (x = CX + AMP·sin(π(i+0.5)) → ±AMP), and one Catmull-Rom
// curve threads every point, so the trail is a smooth snake. The nodes and labels
// are real HTML buttons positioned over a purely decorative SVG spine — labels
// live in the outer margins (|x| ≥ AMP + node radius), so they can never sit on
// the curve. The svg stretches with the container (preserveAspectRatio="none");
// non-scaling strokes keep the trail's weight constant.
const PATH_W = 400; // design width — the container caps at this and scales under it
const PATH_ROW = 64;
const PATH_AMP = 62;
const PATH_CX = PATH_W / 2;
const PATH_PAD_TOP = 56; // headroom for the companion standing on a frontier at the top
const PATH_PAD_BOT = 26;
const VIEW_KEY = "michi.roadmapView"; // per-device preference, shared by every roadmap

function readView() {
  try {
    return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "path";
  } catch {
    return "path"; // no storage (private mode, tests) — the default stands
  }
}

function storeView(v) {
  try {
    localStorage.setItem(VIEW_KEY, v);
  } catch {
    /* per-device nicety only — losing it costs one extra tap */
  }
}

/**
 * One smooth cubic path through every point (Catmull-Rom → bezier). `upTo` caps
 * the number of segments — crucially the capped path reuses the FULL curve's
 * control points, so the walked overdraw sits exactly on the grey spine instead
 * of re-fitting a subtly different curve to the sliced points.
 */
function smoothPath(pts, upTo = Infinity) {
  const n = Math.min(upTo, pts.length - 1);
  if (n < 1) {
    return "";
  }
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0]} ${c1[1]} ${c2[0]} ${c2[1]} ${p2[0]} ${p2[1]}`;
  }
  return d;
}

// a two-post torii gate — persimmon once its milestone is fully walked
function ToriiGate({ complete }) {
  return (
    <svg
      viewBox="0 0 26 20"
      width="24"
      height="19"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      className={complete ? "text-trail-500" : "text-slate-400 dark:text-slate-500"}
    >
      <path d="M2 4.5 Q13 1.5 24 4.5" strokeWidth="2.4" />
      <path d="M5 9.5 h16" strokeWidth="1.8" />
      <path d="M7.5 5.5 V18" strokeWidth="2.2" />
      <path d="M18.5 5.5 V18" strokeWidth="2.2" />
    </svg>
  );
}

function PathView({ rm, species, onDone, onDoing }) {
  // flatten to rows in walk order: each milestone opens with its gate
  const rows = [];
  for (const m of rm.milestones) {
    rows.push({ type: "gate", m });
    for (const st of m.steps) {
      rows.push({ type: "step", st });
    }
  }
  const H = PATH_PAD_TOP + Math.max(0, rows.length - 1) * PATH_ROW + PATH_PAD_BOT;
  const pts = rows.map((_, i) => [
    PATH_CX + PATH_AMP * Math.sin(Math.PI * (i + 0.5)), // strict left/right alternation
    H - PATH_PAD_BOT - i * PATH_ROW,
  ]);

  // the frontier: first step not yet done — where the companion stands. With every
  // step walked there is no frontier, so the companion stands at the TOP node
  // instead, celebrating (a static mood — no confetti replay for old news)
  const frontier = rows.findIndex((r) => r.type === "step" && r.st.status !== "done");
  const walked = rows.length > 0 && frontier === -1;
  const standAt = walked ? rows.length - 1 : frontier;
  // the walked segment: contiguous done steps from the trailhead (gates ride along)
  let doneEnd = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].type !== "step") {
      continue;
    }
    if (rows[i].st.status !== "done") {
      break;
    }
    doneEnd = i;
  }

  const pct = (x) => `${(x / PATH_W) * 100}%`;
  // label zones end a fixed 24px short of the node's center — a %-based gap would
  // shrink with the container and let text slip under the frontier node when narrow
  const labelStyle = (x, y) =>
    x < PATH_CX
      ? { left: 0, width: `calc(${pct(x)} - 24px)`, top: y, transform: "translateY(-50%)" }
      : {
          right: 0,
          width: `calc(${pct(PATH_W - x)} - 24px)`,
          top: y,
          transform: "translateY(-50%)",
        };

  return (
    <div className="relative mx-auto w-full max-w-[400px]" style={{ height: H }}>
      <svg
        viewBox={`0 0 ${PATH_W} ${H}`}
        width="100%"
        height={H}
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
        className="absolute inset-0"
      >
        <path
          d={smoothPath(pts)}
          fill="none"
          strokeWidth="5"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          className="stroke-sand-300 dark:stroke-slate-700"
        />
        {doneEnd > 0 ? (
          <path
            d={smoothPath(pts, doneEnd)}
            fill="none"
            strokeWidth="5"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            className="stroke-trail-500"
          />
        ) : null}
      </svg>

      {rows.map((row, i) => {
        const [x, y] = pts[i];
        const right = x >= PATH_CX; // node right of center → its label sits in the right margin
        if (row.type === "gate") {
          const m = row.m;
          const complete = m.total > 0 && m.done === m.total;
          return (
            <div key={`g_${m.id}`}>
              <div
                className="absolute flex h-8 w-8 items-center justify-center"
                style={{ left: pct(x), top: y, transform: "translate(-50%,-50%)" }}
              >
                <ToriiGate complete={complete} />
              </div>
              <div className="absolute" style={labelStyle(x, y)}>
                <p
                  className={`line-clamp-2 text-xs font-semibold leading-tight ${
                    right ? "text-left" : "text-right"
                  } ${
                    complete
                      ? "text-trail-700 dark:text-trail-400"
                      : "text-slate-500 dark:text-slate-400"
                  }`}
                >
                  {m.title}
                </p>
              </div>
            </div>
          );
        }

        const st = row.st;
        const done = st.status === "done";
        const doing = st.status === "doing";
        const isFrontier = i === frontier;
        const d = isFrontier ? 42 : 34; // the visual circle — r≈21 frontier, r≈17 elsewhere
        const nodeCls = done
          ? "bg-trail-500 text-white"
          : doing
            ? "bg-trail-100 ring-2 ring-trail-500 dark:bg-trail-950"
            : "bg-white ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700";
        return (
          <div key={st.id}>
            {/* the BUTTON is the tap target (≥44px square); the circle inside stays
                the visual size, with the hover/focus ring riding the circle */}
            <button
              onClick={() => onDone(st, !done)}
              aria-label={`${st.title} — ${done ? "done" : doing ? "in progress" : "to do"}`}
              className="group absolute flex items-center justify-center rounded-full focus:outline-none"
              style={{
                left: pct(x),
                top: y,
                width: Math.max(d, 44),
                height: Math.max(d, 44),
                transform: "translate(-50%,-50%)",
              }}
            >
              <span
                className={`flex items-center justify-center rounded-full transition group-hover:ring-2 group-hover:ring-trail-400 group-focus-visible:ring-2 group-focus-visible:ring-trail-400 ${nodeCls} ${
                  isFrontier ? "shadow-md" : "shadow-sm"
                }`}
                style={{ width: d, height: d }}
              >
                {done ? <Check size={16} strokeWidth={3} /> : null}
              </span>
            </button>
            <div className="absolute" style={labelStyle(x, y)}>
              {/* same behaviors as list mode: node = toggle done, title = toggle doing */}
              <button
                disabled={done}
                onClick={() => onDoing(st, !doing)}
                className={`w-full text-[11px] leading-tight ${right ? "text-left" : "text-right"} ${
                  done ? "text-slate-400 line-through" : "text-slate-600 dark:text-slate-300"
                }`}
              >
                <span className="line-clamp-2">
                  {st.title}
                  {st.notes && st.notes.trim() ? (
                    <StickyNote
                      size={11}
                      aria-label="has note"
                      className="ml-1 inline text-iris-500 dark:text-iris-300"
                    />
                  ) : null}
                </span>
                {doing ? (
                  <span className="block text-[10px] font-medium text-iris-500 dark:text-iris-300">
                    in progress
                  </span>
                ) : null}
              </button>
            </div>
          </div>
        );
      })}

      {/* the companion, standing on the frontier — or, with the whole trail walked,
          celebrating on the top node (static: the mood alone, no confetti burst) */}
      {standAt >= 0 ? (
        <div
          className="pointer-events-none absolute"
          style={{
            left: pct(pts[standAt][0]),
            top: pts[standAt][1] - (walked ? 34 : 42) / 2 + 7,
            transform: "translate(-50%,-100%)",
          }}
        >
          <Mascot species={species} mood={walked ? "celebrate" : "idle"} size={44} />
        </div>
      ) : null}
    </div>
  );
}

function RoadmapCard({ rm, ctx, onEdit }) {
  const { save, complete, busy } = ctx;
  const [open, setOpen] = useState(!rm.complete && rm.total > 0);
  const [view, setView] = useState(readView);
  const dl = deadlineInfo(rm, ctx.day);
  const pickView = (v) => {
    setView(v);
    storeView(v);
  };

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

  // deleteStep also unlinks tasks pointing at the step — the server rejects
  // dangling task.stepId refs, so a bare filter would 400 the save
  const delStep = (step) => save((s) => deleteStep(s, step.id));

  const saveNote = (step, notes) =>
    save((s) => {
      const t = s.steps.find((x) => x.id === step.id);
      if (t) {
        t.notes = notes;
      }
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

  const remove = async () => {
    // deleteRoadmap takes milestones + steps along and unlinks projects/tasks
    // that pointed here (the server rejects dangling refs). save() itself
    // offers the undo toast from the PUT's trash receipt.
    await save((s) => deleteRoadmap(s, rm.id));
    focusMainHeading(); // the card just vanished — don't drop focus to <body>
  };

  return (
    <Card className={`overflow-hidden ${rm.archived ? "opacity-60" : ""}`}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span
          className="h-9 w-1.5 shrink-0 rounded-full"
          style={{ background: rm.color || "#4E8640" }}
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
          {dl && !dl.done ? (
            <p
              className={`mt-1 flex items-center gap-1 text-xs ${dl.overdue ? "text-rose-500" : "text-slate-400"}`}
            >
              <CalendarClock size={11} />
              {dl.overdue ? "past due" : `due ${shortDate(rm.targetDate)}`} · ~{dl.perDay}/day to
              finish
            </p>
          ) : null}
        </div>
        {rm.targetDate ? (
          // the goal object: a daruma keeps its blank eye until the roadmap is walked
          <span
            role="img"
            aria-label={`finish by ${shortDate(rm.targetDate)} — the daruma earns its second eye at 100%`}
            title={`finish by ${shortDate(rm.targetDate)} — the daruma earns its second eye at 100%`}
            className="shrink-0"
          >
            <Mascot species="daruma" size={34} eyesFilled={rm.complete} />
          </span>
        ) : null}
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
              className="mb-2 inline-flex items-center gap-1 text-xs text-trail-700 hover:underline dark:text-trail-400"
            >
              <ExternalLink size={12} /> source roadmap
            </a>
          ) : null}

          {rm.milestones.length === 0 ? (
            <p className="py-1 text-sm text-slate-400">
              No milestones yet — add your first checkpoint below.
            </p>
          ) : (
            <>
              {/* a stepless roadmap has no trail to draw (and list mode holds the
                  add-step forms), so the toggle waits for the first step */}
              {rm.total > 0 ? (
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div
                    role="group"
                    aria-label="Roadmap view"
                    className="inline-flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800"
                  >
                    {["path", "list"].map((v) => (
                      <button
                        key={v}
                        onClick={() => pickView(v)}
                        aria-pressed={view === v}
                        className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                          view === v
                            ? "bg-white text-trail-700 shadow-sm dark:bg-slate-700 dark:text-trail-300"
                            : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                        }`}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                  {view === "path" ? (
                    <span className="text-[11px] text-slate-400">reorder in list view</span>
                  ) : null}
                </div>
              ) : null}
              {view === "path" && rm.total > 0 ? (
                <PathView
                  rm={rm}
                  species={ctx.state.profile?.mascot}
                  onDone={setDone}
                  onDoing={setDoing}
                />
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
                            onSaveNote={saveNote}
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
            </>
          )}

          <div className="mt-3 border-t border-dashed border-slate-200 pt-2 dark:border-slate-700">
            <AddInline placeholder="Add a milestone…" onAdd={addMilestone} busy={busy} />
          </div>

          <div className="mt-3 flex items-center justify-end gap-1">
            <IconButton label="Edit roadmap" onClick={() => onEdit(rm)}>
              <Pencil size={16} />
            </IconButton>
            <IconButton label={rm.archived ? "Unarchive" : "Archive"} onClick={toggleArchive}>
              {rm.archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
            </IconButton>
            <ConfirmButton label="Delete roadmap" onConfirm={remove} className="h-10 min-w-10">
              <Trash2 size={16} />
            </ConfirmButton>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function ColorPicker({ color, setColor }) {
  return (
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
  );
}

function RoadmapModal({ ctx, roadmap = null, onClose }) {
  const { save, busy } = ctx;
  const editing = !!roadmap;
  const [title, setTitle] = useState(roadmap?.title || "");
  const [sourceUrl, setSourceUrl] = useState(roadmap?.sourceUrl || "");
  const [color, setColor] = useState(roadmap?.color || COLORS[0]);
  const [targetDate, setTargetDate] = useState(roadmap?.targetDate || "");
  const [stepMinutes, setStepMinutes] = useState(
    roadmap?.stepMinutes != null ? String(roadmap.stepMinutes) : "",
  );

  const submitting = useRef(false); // Enter + click (or two quick Enters) → one create
  const commit = async () => {
    if (submitting.current || !title.trim()) {
      return;
    }
    const fields = {
      title: title.trim(),
      sourceUrl: sourceUrl.trim() || null,
      color,
      targetDate: targetDate || null,
      stepMinutes: stepMinutes === "" ? null : Number(stepMinutes),
    };
    submitting.current = true;
    const ok = await save((s) => {
      if (editing) {
        const r = s.roadmaps.find((x) => x.id === roadmap.id);
        if (r) {
          Object.assign(r, fields);
        }
      } else {
        s.roadmaps.push({
          id: uid("rm"),
          archived: false,
          position: nextPosition(s.roadmaps),
          ...fields,
        });
      }
    });
    submitting.current = false;
    if (ok !== false) {
      onClose();
    }
  };

  return (
    <Modal
      title={editing ? "Edit roadmap" : "New roadmap"}
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
          placeholder="e.g. Bare-metal embedded"
          onKeyDown={(e) => e.key === "Enter" && commit()}
        />
      </Field>
      <div className="flex gap-3">
        <Field label="Finish by" hint="Optional — Michi paces you to hit it.">
          <Input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
        </Field>
        <Field label="Minutes / step" hint="For the planner's budget.">
          <Select value={stepMinutes} onChange={(e) => setStepMinutes(e.target.value)}>
            {STEP_MINUTE_OPTS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Source link" hint="Optional — a roadmap.sh track, a GitHub repo, a course…">
        <Input
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          placeholder="https://roadmap.sh/…"
        />
      </Field>
      <Field label="Color">
        <ColorPicker color={color} setColor={setColor} />
      </Field>
    </Modal>
  );
}

function ImportRoadmapModal({ ctx, onClose }) {
  const { save, busy } = ctx;
  const [title, setTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [targetDate, setTargetDate] = useState("");
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
        targetDate: targetDate || null,
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
        <Field label="Finish by" hint="Optional deadline.">
          <Input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
        </Field>
      </div>
      <Field label="Source link">
        <Input
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          placeholder="https://roadmap.sh/…"
        />
      </Field>
      <Field label="Color">
        <ColorPicker color={color} setColor={setColor} />
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
                    <span className="text-trail-700 dark:text-trail-400">{m.title}</span> —{" "}
                    {m.steps.length} steps
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
  const [editRm, setEditRm] = useState(null);
  const [ritual, setRitual] = useState(null); // the daruma's second-eye toast
  const tree = roadmapTree(ctx.state);

  // the ritual: a dated roadmap crossing to 100% opens the daruma's second eye —
  // once ever per roadmap (lib/celebrate.js keeps the ledger in localStorage)
  const { state } = ctx;
  useEffect(() => {
    const ev = checkRituals(roadmapTree(state));
    if (ev) {
      confettiBurst();
      setRitual(ev);
    }
  }, [state]);
  // find the latest version of the roadmap being edited (tree carries it)
  const editing = editRm ? tree.find((r) => r.id === editRm) : null;
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
            <RoadmapCard key={rm.id} rm={rm} ctx={ctx} onEdit={() => setEditRm(rm.id)} />
          ))}
          {archived.length ? (
            <div className="pt-2">
              <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Archived
              </p>
              <div className="space-y-3">
                {archived.map((rm) => (
                  <RoadmapCard key={rm.id} rm={rm} ctx={ctx} onEdit={() => setEditRm(rm.id)} />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}

      {adding && <RoadmapModal ctx={ctx} onClose={() => setAdding(false)} />}
      {editing && <RoadmapModal ctx={ctx} roadmap={editing} onClose={() => setEditRm(null)} />}
      {importing && <ImportRoadmapModal ctx={ctx} onClose={() => setImporting(false)} />}
      {ritual ? (
        // offset below App's celebration toast (top-4) so simultaneous fires stack
        <Celebration
          event={ritual}
          species={ctx.state.profile?.mascot}
          offset="top-20"
          onClose={() => setRitual(null)}
        />
      ) : null}
    </div>
  );
}
