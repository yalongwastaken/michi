// insights.js — small, cheap "nudges" computed from data you already have, so Michi
// can point things out instead of waiting to be asked. Pure + deterministic.
import { roadmapProgress } from "./engine.js";
// note: daysUntil deliberately *unclamped* here — a ≤0 result is how we detect a
// roadmap that already slipped past its finish date (the planner clamps instead)
import { dayKey, daysUntil, daysSince, shiftDay } from "./dates.js";
import { lastActiveByRoadmap } from "./project.js";
import { KATA_LIBRARY } from "./kata.js";

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

// ── kata suggestions: which forms the data says would help ──────────────────────
// Rendered in the dōjō library (NOT as nudges). Each rule reads real history and
// offers a builtin the user hasn't added — added-then-retired counts as "knows
// about it, chose not to", so it's never re-offered.

/** Local hour of a completion timestamp, or null when it can't be parsed. */
function hourOf(ts) {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d.getHours();
}

/**
 * Up to 2 kata suggestions from real data, for builtins not already added.
 * @returns {Array<{builtinId:string, title:string, reason:string}>}
 */
export function kataSuggestions(state, { today = dayKey() } = {}) {
  const added = new Set((state.kata || []).map((k) => k.builtinId).filter(Boolean));
  const byId = new Map(KATA_LIBRARY.map((k) => [k.id, k]));
  const out = [];
  const suggest = (builtinId, reason) => {
    if (!added.has(builtinId) && byId.has(builtinId)) {
      out.push({ builtinId, title: byId.get(builtinId).title, reason });
    }
  };

  // honoring a kata is practice, not work — a kata's own completion rows can
  // never be evidence that another form would help (three evening honors are
  // not three late-night finishes, and a morning honor isn't a morning's work)
  const completions = (state.completions || []).filter(
    (c) => c?.day && c.day <= today && c.kind !== "kata",
  );
  const weekAgo = shiftDay(today, -6); // the last 7 calendar days, today included
  const thisWeek = completions.filter((c) => c.day >= weekAgo);

  // (a) the day keeps ending late → shutdown ritual
  const late = thisWeek.filter((c) => {
    const h = hourOf(c.ts);
    return h != null && h >= 21;
  }).length;
  if (late >= 3) {
    suggest("shutdown", `${late} completions after 21:00 this week — close the day on purpose`);
  }

  // (b) silent mornings across the last 7 ACTIVE days → a 25-minute first block.
  // Needs at least 3 active days of evidence — one quiet afternoon isn't a pattern.
  const activeDays = [...new Set(completions.map((c) => c.day))].sort().slice(-7);
  if (activeDays.length >= 3) {
    const recent = new Set(activeDays);
    const anyMorning = completions.some((c) => {
      const h = hourOf(c.ts);
      return recent.has(c.day) && h != null && h < 12;
    });
    if (!anyMorning) {
      suggest("first-block", "your mornings are your quietest hours");
    }
  }

  // (c) too many things half-open → the one-tab rule
  const doing = [...(state.tasks || []), ...(state.steps || [])].filter(
    (x) => x.status === "doing",
  ).length;
  if (doing >= 4) {
    suggest("one-tab", "a lot of things are half-open");
  }

  return out.slice(0, 2);
}
