// goals.js — progress rollups for the overarching goals ("climb V10", "Japanese
// N1"). A goal accumulates progress by ATTRIBUTION: any task/step carrying its
// goal_id contributes, and — crucially — attribution is retroactive. Because the
// completions log buckets every completion event by day and keeps ref_id, joining
// the log to an item's CURRENT goal_id credits all of that item's past showings,
// including a daily-recurring task honored dozens of times. That's the "assign
// completed work and watch consistent progress accrue" the goals layer is for.
import { dayKey, prevDay } from "./dates.js";

/**
 * Per-goal progress read from the completion log joined to current attribution.
 * @param {Object} state a FULL state (needs the completions log)
 * @param {Object} [opts] { today, heatDays } — heatDays sizes the contribution strip
 * @returns {Object<string, {count, activeDays, lastDay, linkedTasks, linkedSteps, heat}>}
 *   keyed by goal id. `count` is completion EVENTS (recurring work counts each time),
 *   `heat` is oldest→newest daily counts, exactly heatDays long (mirrors momentum's).
 */
export function goalProgress(state, { today = dayKey(), heatDays = 91 } = {}) {
  const tasks = state.tasks || [];
  const steps = state.steps || [];
  // ref_id → goal_id, by kind, for the current attribution
  const taskGoal = new Map(tasks.filter((t) => t.goalId).map((t) => [t.id, t.goalId]));
  const stepGoal = new Map(steps.filter((s) => s.goalId).map((s) => [s.id, s.goalId]));

  const perGoal = new Map(); // goalId → { count, byDay:Map<day,count>, lastDay }
  const bump = (gid, day) => {
    if (!gid) {
      return;
    }
    let rec = perGoal.get(gid);
    if (!rec) {
      rec = { count: 0, byDay: new Map(), lastDay: null };
      perGoal.set(gid, rec);
    }
    rec.count += 1;
    rec.byDay.set(day, (rec.byDay.get(day) || 0) + 1);
    if (!rec.lastDay || day > rec.lastDay) {
      rec.lastDay = day;
    }
  };
  for (const c of state.completions || []) {
    if (!c?.day) {
      continue;
    }
    if (c.kind === "task") {
      bump(taskGoal.get(c.refId), c.day);
    } else if (c.kind === "step") {
      bump(stepGoal.get(c.refId), c.day);
    }
  }

  const out = {};
  for (const g of state.goals || []) {
    const rec = perGoal.get(g.id) || { count: 0, byDay: new Map(), lastDay: null };
    const heat = [];
    let cursor = today;
    for (let i = 0; i < heatDays; i++) {
      heat.unshift({ date: cursor, count: rec.byDay.get(cursor) || 0 });
      cursor = prevDay(cursor);
    }
    out[g.id] = {
      count: rec.count,
      activeDays: rec.byDay.size,
      lastDay: rec.lastDay,
      // current attributions (including not-yet-done ones) — the "N tasks · M steps" line
      linkedTasks: tasks.filter((t) => t.goalId === g.id).length,
      linkedSteps: steps.filter((s) => s.goalId === g.id).length,
      heat,
    };
  }
  return out;
}
