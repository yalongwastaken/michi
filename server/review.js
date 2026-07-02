// review.js — a look back at the last N days: what you finished, which roadmaps moved,
// and what slipped. Pure over the completion log + current model. Titles are resolved
// from the *current* rows (a since-deleted item shows as "(removed)").
import { roadmapProgress } from "./engine.js";
import { dayKey, shiftDay } from "./dates.js";

/**
 * @param {Object} state full model
 * @param {Object} [opts] { today, days=7 }
 * @returns {{from,to,days,completed,activeDays,byDay,finished,advanced,slipped}}
 */
export function weeklyReview(state, { today = dayKey(), days = 7 } = {}) {
  const from = shiftDay(today, -(days - 1));
  const inRange = (d) => d && d >= from && d <= today;
  const comps = (state.completions || []).filter((c) => inRange(c.day));

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
  };
}
