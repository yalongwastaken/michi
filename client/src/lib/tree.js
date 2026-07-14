// tree.js — compose the flat roadmap/milestone/step arrays into a nested tree the
// Roadmaps view can render, plus small progress helpers. Pure functions.

/** Build [{...roadmap, milestones:[{...m, steps:[...]}], done, total, pct, complete}]. */
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
    return {
      ...r,
      milestones: ms,
      done,
      total,
      pct: total ? Math.round((done / total) * 100) : 0,
      // pct is display math (Math.round calls 199/200 "100") — anything that means
      // "actually finished" (the daruma's eye, the ritual) must key on this instead
      complete: total > 0 && done === total,
    };
  });
}

/**
 * Move the sibling `id` up (-1) or down (+1) and re-number positions contiguously.
 * Mutates the passed rows in place (they're refs into save()'s cloned state).
 */
export function reorder(siblings, id, dir) {
  const sorted = [...siblings].sort((a, b) => a.position - b.position);
  const i = sorted.findIndex((x) => x.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= sorted.length) {
    return;
  }
  [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
  sorted.forEach((x, idx) => (x.position = idx));
}

/** Next position for a list (max + 1), so appends land at the end. */
export function nextPosition(rows) {
  return rows.reduce((max, r) => Math.max(max, (r.position ?? 0) + 1), 0);
}
