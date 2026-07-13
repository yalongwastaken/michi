// mutate.js — shared delete mutators for the full-state save() path. The server
// rejects dangling references (a project pointing at a deleted roadmap, a task
// pointing at a deleted step or project all 400 the PUT), so every delete must
// also sever whatever still points at the removed rows. Centralized here so no
// view can forget a link. Each function mutates the cloned state save() hands it.

/** Delete a roadmap plus its milestones/steps; unlink projects and tasks. */
export function deleteRoadmap(s, roadmapId) {
  const msIds = new Set(
    (s.milestones || []).filter((m) => m.roadmapId === roadmapId).map((m) => m.id),
  );
  const stepIds = new Set(
    (s.steps || []).filter((st) => msIds.has(st.milestoneId)).map((st) => st.id),
  );
  s.roadmaps = (s.roadmaps || []).filter((r) => r.id !== roadmapId);
  s.milestones = (s.milestones || []).filter((m) => !msIds.has(m.id));
  s.steps = (s.steps || []).filter((st) => !stepIds.has(st.id));
  for (const p of s.projects || []) {
    if (p.roadmapId === roadmapId) {
      p.roadmapId = null;
    }
  }
  for (const t of s.tasks || []) {
    if (t.stepId && stepIds.has(t.stepId)) {
      t.stepId = null;
    }
  }
}

/** Delete one step; unlink tasks that pointed at it. */
export function deleteStep(s, stepId) {
  s.steps = (s.steps || []).filter((st) => st.id !== stepId);
  for (const t of s.tasks || []) {
    if (t.stepId === stepId) {
      t.stepId = null;
    }
  }
}

/** Delete a project; unlink tasks that pointed at it. */
export function deleteProject(s, projectId) {
  s.projects = (s.projects || []).filter((p) => p.id !== projectId);
  for (const t of s.tasks || []) {
    if (t.projectId === projectId) {
      t.projectId = null;
    }
  }
}

/** Delete a task (no inbound references — kept here so deletes share one home). */
export function deleteTask(s, taskId) {
  s.tasks = (s.tasks || []).filter((t) => t.id !== taskId);
}
