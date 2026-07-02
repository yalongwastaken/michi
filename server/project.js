// project.js — shared *projections* over the unified state ("project" the verb,
// not the projects table): the minimal line shapes the client renders in the Today
// queue / day plan, plus the step→roadmap and roadmap-activity maps derived from
// the completion log. engine.js, planner.js and suggest.js each carried a
// hand-synced near-copy of these; one drifting field meant three places to fix.

/**
 * Step → minimal shape the client renders. `extra` merges additional fields on
 * top of the shared base (planner adds { reason, estMin }; suggest adds
 * { estMin }) so every caller renders the same core shape.
 */
export function stepLine(step, milestone, roadmap, extra = {}) {
  return {
    kind: "step",
    id: step.id,
    title: step.title,
    status: step.status,
    resourceUrl: step.resourceUrl || null,
    roadmapId: roadmap?.id || null,
    roadmapTitle: roadmap?.title || null,
    roadmapColor: roadmap?.color || null,
    milestoneTitle: milestone?.title || null,
    ...extra,
  };
}

/**
 * Task → minimal shape the client renders. The base carries the task's own raw
 * estimate; the planner/suggest override `estMin` via `extra` with their computed
 * cost. The Today queue presents a recurring task that's pending for today as
 * actionable via `{ status: "todo" }`, even though its stored status may still be
 * "done" from a previous day's completion.
 */
export function taskLine(task, extra = {}) {
  return {
    kind: "task",
    id: task.id,
    title: task.title,
    status: task.status,
    due: task.due || null,
    recurrence: task.recurrence || null,
    estMin: task.estMin ?? null,
    stepId: task.stepId || null,
    projectId: task.projectId || null,
    ...extra,
  };
}

/** Map each step id → its roadmap id (via its milestone). */
export function stepToRoadmap(state) {
  const mToR = new Map((state.milestones || []).map((m) => [m.id, m.roadmapId]));
  const map = new Map();
  for (const s of state.steps || []) {
    const rid = mToR.get(s.milestoneId);
    if (rid) {
      map.set(s.id, rid);
    }
  }
  return map;
}

/**
 * Most recent local day each roadmap saw activity, read from the completion log:
 * step completions count via the step's milestone's roadmap, task completions via
 * the step the task is linked to. Pass a precomputed `s2r` when the caller
 * already built one (the planner does) to avoid deriving it twice.
 */
export function lastActiveByRoadmap(state, s2r = stepToRoadmap(state)) {
  const taskRoadmap = new Map();
  for (const t of state.tasks || []) {
    if (t.stepId && s2r.has(t.stepId)) {
      taskRoadmap.set(t.id, s2r.get(t.stepId));
    }
  }
  const last = new Map();
  for (const c of state.completions || []) {
    const rid = c.kind === "step" ? s2r.get(c.refId) : taskRoadmap.get(c.refId);
    if (rid && c.day && (!last.get(rid) || c.day > last.get(rid))) {
      last.set(rid, c.day);
    }
  }
  return last;
}
