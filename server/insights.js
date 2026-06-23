// insights.js — small, cheap "nudges" computed from data you already have, so Michi
// can point things out instead of waiting to be asked. Pure + deterministic.
import { roadmapProgress, dayKey } from "./engine.js";

/** Whole days from `day` back to `from` (both YYYY-MM-DD); null if `from` missing. */
function daysSince(from, day) {
  if (!from) {
    return null;
  }
  return Math.round((Date.parse(`${day}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000);
}

/** Per-roadmap last activity day (from the completion log + step→roadmap mapping). */
function lastActiveByRoadmap(state) {
  const mToR = new Map((state.milestones || []).map((m) => [m.id, m.roadmapId]));
  const s2r = new Map();
  for (const s of state.steps || []) {
    const rid = mToR.get(s.milestoneId);
    if (rid) {
      s2r.set(s.id, rid);
    }
  }
  const taskR = new Map();
  for (const t of state.tasks || []) {
    if (t.stepId && s2r.has(t.stepId)) {
      taskR.set(t.id, s2r.get(t.stepId));
    }
  }
  const last = new Map();
  for (const c of state.completions || []) {
    const rid = c.kind === "step" ? s2r.get(c.refId) : taskR.get(c.refId);
    if (rid && (!last.get(rid) || c.day > last.get(rid))) {
      last.set(rid, c.day);
    }
  }
  return last;
}

const NEGLECT_DAYS = 7;

/**
 * Up to `limit` short nudges, most useful first: overdue → near-done → neglected.
 * @returns {Array<{kind:string, tone:"warn"|"good"|"info", text:string, roadmapId?:string}>}
 */
export function insights(state, { today = dayKey(), limit = 3 } = {}) {
  const out = [];

  // overdue, non-recurring tasks
  const overdue = (state.tasks || []).filter(
    (t) => !t.recurrence && t.status !== "done" && t.due && t.due < today,
  ).length;
  if (overdue) {
    out.push({
      kind: "overdue",
      tone: "warn",
      text: `${overdue} task${overdue > 1 ? "s" : ""} overdue — knock ${overdue > 1 ? "them" : "it"} out or reschedule.`,
    });
  }

  const progress = roadmapProgress(state).filter((r) => !r.archived && r.total > 0);

  // a roadmap almost finished — a nudge to close it out
  const near = progress.filter((r) => r.pct >= 80 && r.pct < 100).sort((a, b) => b.pct - a.pct)[0];
  if (near) {
    out.push({
      kind: "near-done",
      tone: "good",
      text: `${near.title} is ${near.pct}% done — finish it off.`,
      roadmapId: near.id,
    });
  }

  // the most-neglected unfinished roadmap (untouched ≥ a week, or created long ago and
  // never started) — but don't nag about brand-new roadmaps
  const last = lastActiveByRoadmap(state);
  const createdAt = new Map(
    (state.roadmaps || []).map((r) => [r.id, (r.createdAt || "").slice(0, 10)]),
  );
  let worst = null;
  for (const r of progress) {
    if (r.pct >= 100) {
      continue;
    }
    const since = daysSince(last.get(r.id) || createdAt.get(r.id), today);
    if (since != null && since >= NEGLECT_DAYS && (!worst || since > worst.since)) {
      worst = { ...r, since };
    }
  }
  if (worst) {
    out.push({
      kind: "neglected",
      tone: "info",
      text: `${worst.title} hasn't moved in ${worst.since} days — a quick step keeps it alive.`,
      roadmapId: worst.id,
    });
  }

  return out.slice(0, limit);
}
