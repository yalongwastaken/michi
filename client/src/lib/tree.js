// tree.js — compose the flat roadmap/milestone/step arrays into a nested tree the
// Roadmaps view can render, plus small progress helpers. Pure functions.

/** Build [{...roadmap, milestones:[{...m, steps:[...]}], done, total, pct}]. */
export function roadmapTree(state) {
  const milestones = state.milestones || [];
  const steps = state.steps || [];
  return (state.roadmaps || []).map((r) => {
    const ms = milestones
      .filter((m) => m.roadmapId === r.id)
      .sort((a, b) => a.position - b.position)
      .map((m) => {
        const ss = steps
          .filter((s) => s.milestoneId === m.id)
          .sort((a, b) => a.position - b.position);
        const done = ss.filter((s) => s.status === "done").length;
        return { ...m, steps: ss, done, total: ss.length };
      });
    const total = ms.reduce((a, m) => a + m.total, 0);
    const done = ms.reduce((a, m) => a + m.done, 0);
    return { ...r, milestones: ms, done, total, pct: total ? Math.round((done / total) * 100) : 0 };
  });
}

/** Next position for a list (max + 1), so appends land at the end. */
export function nextPosition(rows) {
  return rows.reduce((max, r) => Math.max(max, (r.position ?? 0) + 1), 0);
}
