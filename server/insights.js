// insights.js — small, cheap "nudges" computed from data you already have, so Michi
// can point things out instead of waiting to be asked. Pure + deterministic.
import { roadmapProgress } from "./engine.js";
// note: daysUntil deliberately *unclamped* here — a ≤0 result is how we detect a
// roadmap that already slipped past its finish date (the planner clamps instead)
import { dayKey, daysUntil, daysSince } from "./dates.js";
import { lastActiveByRoadmap } from "./project.js";

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
  const byId = new Map((state.roadmaps || []).map((r) => [r.id, r]));

  // deadline pressure: a roadmap with a finish-by date that needs >1 step/day, is due
  // soon, or has slipped past — the most-pressured one first
  const deadlines = [];
  for (const r of progress) {
    const rm = byId.get(r.id);
    if (!rm?.targetDate || r.pct >= 100) {
      continue;
    }
    const remaining = r.total - r.done;
    const left = daysUntil(rm.targetDate, today); // ≤0 means past due
    const perDay = Math.ceil(remaining / Math.max(1, left));
    if (left <= 0) {
      deadlines.push({
        r,
        text: `${r.title} is past its finish date — ${remaining} step${remaining > 1 ? "s" : ""} left.`,
        sort: -left + 100,
      });
    } else if (perDay >= 2 || left <= 3) {
      deadlines.push({
        r,
        text: `${r.title}: ${left} day${left > 1 ? "s" : ""} left, ~${perDay}/day to finish.`,
        sort: perDay * 10 - left,
      });
    }
  }
  const worstDeadline = deadlines.sort((a, b) => b.sort - a.sort)[0];
  if (worstDeadline) {
    out.push({
      kind: "deadline",
      tone: "warn",
      text: worstDeadline.text,
      roadmapId: worstDeadline.r.id,
    });
  }

  // a roadmap almost finished — a nudge to close it out
  const near = progress.filter((r) => r.pct >= 80 && r.pct < 100).sort((a, b) => b.pct - a.pct)[0];
  if (near) {
    out.push({
      kind: "near-done",
      tone: "good",
      text: `${near.title} is ${near.pct}% done — the summit's in sight.`,
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
      text: `${worst.title} hasn't moved in ${worst.since} days — one small step puts it back on the path.`,
      roadmapId: worst.id,
    });
  }

  return out.slice(0, limit);
}
