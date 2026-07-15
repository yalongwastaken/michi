// review.js — a look back at the last N days: what you finished, which roadmaps moved,
// and what slipped. Pure over the completion log + current model. Titles are resolved
// from the *current* rows (a since-deleted item shows as "(removed)").
import { roadmapProgress } from "./engine.js";
import { dayKey, shiftDay } from "./dates.js";

function weekdayName(day) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    timeZone: "UTC",
  });
}

/**
 * One deterministic sentence about the week's shape — the most interesting true
 * thing, in priority order: a standout day, a roadmap that clearly led, a notable
 * shift from last week (gentle when down — never shaming), or the quiet-week line.
 * Null when the week was ordinary — the card's numbers already tell that story.
 */
function reflect({ byDay, completed, byRoadmap, rById, prevCompleted }) {
  // (a) a standout day: a unique best with real volume
  const best = byDay.reduce((a, d) => (d.count > a.count ? d : a), { count: 0 });
  const ties = byDay.filter((d) => d.count === best.count).length;
  if (best.count >= 3 && ties === 1) {
    return `${weekdayName(best.date)} was the big one — ${best.count} finished.`;
  }
  // (b) a roadmap that clearly led the week
  for (const [rid, n] of byRoadmap) {
    const title = rById.get(rid)?.title;
    if (title && n >= 3 && n * 10 >= completed * 6) {
      return `Most of the week went down the ${title} path.`;
    }
  }
  // (c) a notable shift against the prior week
  if (completed >= 4 && prevCompleted >= 1 && completed >= prevCompleted * 2) {
    // "twice" only when it truly is ~2× — a 3×-or-more week gets its real number
    const ratio = completed / prevCompleted;
    if (ratio >= 3) {
      return `${Math.round(ratio)}× last week's pace — ${completed} finished to last week's ${prevCompleted}.`;
    }
    return `Twice last week's pace — ${completed} finished to last week's ${prevCompleted}.`;
  }
  if (completed >= 1 && prevCompleted >= 4 && prevCompleted >= completed * 2) {
    return `A lighter week than last — and that's fine; ${completed} finished still moved the path.`;
  }
  // (d) a quiet week
  if (completed === 0) {
    return "A quiet week on the path — one step gets it moving.";
  }
  return null;
}

/**
 * @param {Object} state full model
 * @param {Object} [opts] { today, days=7 }
 * @returns {{from,to,days,completed,activeDays,byDay,finished,advanced,slipped,reflection}}
 */
export function weeklyReview(state, { today = dayKey(), days = 7 } = {}) {
  const from = shiftDay(today, -(days - 1));
  const inRange = (d) => d && d >= from && d <= today;
  // kata are practice, not "work finished" — they have their own ledger (discipline
  // grade + clean days). Exclude them here so the weekly count and the finished list
  // match the daily goal's semantics (tasks + steps only), instead of being inflated
  // by honor rows that also can't resolve a title (they'd show as "(removed)").
  const comps = (state.completions || []).filter((c) => inRange(c.day) && c.kind !== "kata");

  const byDay = [];
  for (let i = 0; i < days; i++) {
    const date = shiftDay(from, i);
    byDay.push({ date, count: comps.filter((c) => c.day === date).length });
  }

  const stepById = new Map((state.steps || []).map((s) => [s.id, s]));
  const taskById = new Map((state.tasks || []).map((t) => [t.id, t]));
  const mToR = new Map((state.milestones || []).map((m) => [m.id, m.roadmapId]));
  const rById = new Map((state.roadmaps || []).map((r) => [r.id, r]));

  const seen = new Set();
  const finished = [];
  const advanced = new Set();
  const byRoadmap = new Map(); // rid → completions this week, for the reflection
  for (const c of [...comps].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0))) {
    let title = "(removed)";
    let rid = null;
    if (c.kind === "step") {
      const s = stepById.get(c.refId);
      if (s) {
        title = s.title;
        rid = mToR.get(s.milestoneId);
      }
    } else {
      const t = taskById.get(c.refId);
      if (t) {
        title = t.title;
        rid = t.stepId ? mToR.get(stepById.get(t.stepId)?.milestoneId) : null;
      }
    }
    if (rid) {
      advanced.add(rid);
      byRoadmap.set(rid, (byRoadmap.get(rid) || 0) + 1);
    }
    const key = `${c.kind}:${c.refId}`;
    if (!seen.has(key)) {
      seen.add(key);
      if (finished.length < 8) {
        finished.push({ title, kind: c.kind, day: c.day });
      }
    }
  }

  const slipped = [];
  const overdue = (state.tasks || []).filter(
    (t) => !t.recurrence && t.status !== "done" && t.due && t.due < today,
  ).length;
  if (overdue) {
    slipped.push(`${overdue} task${overdue > 1 ? "s" : ""} overdue`);
  }
  for (const r of roadmapProgress(state)) {
    const rm = rById.get(r.id);
    if (rm && !rm.archived && rm.targetDate && rm.targetDate < today && r.pct < 100) {
      slipped.push(`${r.title} passed its finish date (${r.pct}%)`);
    }
  }

  // the prior window (same length, ending the day before `from`) for the reflection
  const prevFrom = shiftDay(from, -days);
  const prevCompleted = (state.completions || []).filter(
    (c) => c.day && c.day >= prevFrom && c.day < from && c.kind !== "kata",
  ).length;

  return {
    from,
    to: today,
    days,
    completed: comps.length,
    activeDays: new Set(comps.map((c) => c.day)).size,
    byDay,
    finished,
    advanced: [...advanced].map((id) => rById.get(id)?.title).filter(Boolean),
    slipped,
    reflection: reflect({ byDay, completed: comps.length, byRoadmap, rById, prevCompleted }),
  };
}
