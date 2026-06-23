// suggest.js — OPTIONAL local-model refinement of the day plan. Off by default.
//
// When enabled, this talks to a local Ollama server (default http://localhost:11434)
// running on the same mini PC — so your data still never leaves the box; this is a
// localhost call, not the internet. The model is handed the FULL picture (your data
// is tiny — kilobytes — so it always fits in context) plus the planner's draft, and
// asked to pick a sensible day from a fixed menu of candidates. Its answer is
// validated against that menu; anything malformed, slow, or unreachable falls back to
// the deterministic planner. The planner is always the floor — the model only ever
// re-orders / re-selects from a known-good set.
//
// Enable with:  MICHI_LLM=1  (optionally MICHI_LLM_MODEL=…, MICHI_LLM_URL=…)

/** Is the optional model layer turned on? */
export function aiEnabled() {
  return /^(1|true|on|yes)$/i.test(String(process.env.MICHI_LLM || ""));
}

export function aiConfig() {
  return {
    enabled: aiEnabled(),
    model: process.env.MICHI_LLM_MODEL || "llama3.2:3b",
    url: process.env.MICHI_LLM_URL || "http://localhost:11434",
  };
}

const key = (kind, id) => `${kind}:${id}`;

/**
 * The fixed menu the model may choose from: today's obligations + the next not-done
 * steps of each active roadmap (capped). Returns both compact rows for the prompt and
 * a key→clientItem map so chosen keys map back to fully-shaped items for the UI.
 */
export function buildCandidates(state, { today, taskDefaultMin = 20, defaultStepMin = 30 } = {}) {
  const rows = [];
  const byKey = new Map();
  const add = (k, row, item) => {
    rows.push(row);
    byKey.set(k, item);
  };

  const tasks = state.tasks || [];
  const isDoneToday = (t) => t.status === "done" && (t.doneAt || "").slice(0, 10) === today;
  for (const t of tasks) {
    if (isDoneToday(t) || (t.status === "done" && !t.recurrence)) {
      continue;
    }
    const k = key("task", t.id);
    const estMin = Number.isFinite(Number(t.estMin)) ? Number(t.estMin) : taskDefaultMin;
    add(
      k,
      {
        key: k,
        title: t.title,
        type: "task",
        due: t.due || null,
        recurrence: t.recurrence || null,
        estMin,
      },
      {
        kind: "task",
        id: t.id,
        title: t.title,
        status: t.status,
        due: t.due || null,
        recurrence: t.recurrence || null,
        stepId: t.stepId || null,
        projectId: t.projectId || null,
        estMin,
      },
    );
  }

  const roadmaps = (state.roadmaps || []).filter((r) => !r.archived);
  const milestones = state.milestones || [];
  const steps = state.steps || [];
  for (const r of roadmaps) {
    const rms = milestones
      .filter((m) => m.roadmapId === r.id)
      .sort((a, b) => a.position - b.position);
    let taken = 0;
    for (const m of rms) {
      for (const s of steps
        .filter((x) => x.milestoneId === m.id && x.status !== "done")
        .sort((a, b) => a.position - b.position)) {
        if (taken >= 3) {
          break; // a few upcoming steps per roadmap is plenty of menu
        }
        const k = key("step", s.id);
        add(
          k,
          {
            key: k,
            title: s.title,
            type: "step",
            roadmap: r.title,
            milestone: m.title,
            status: s.status,
            estMin: defaultStepMin,
          },
          {
            kind: "step",
            id: s.id,
            title: s.title,
            status: s.status,
            resourceUrl: s.resourceUrl || null,
            roadmapId: r.id,
            roadmapTitle: r.title,
            roadmapColor: r.color || null,
            milestoneTitle: m.title,
            estMin: defaultStepMin,
          },
        );
        taken += 1;
      }
    }
  }
  return { rows, byKey };
}

/** Build the chat messages. Pure → unit-testable without a model. */
export function buildMessages(rows, budgetMin) {
  const system =
    "You are Michi, a calm personal learning coach. From the candidate menu, choose a " +
    "realistic set of items to do TODAY that fits the time budget. Prefer things that are " +
    "due, continue what's already in progress, and spread effort across roadmaps so none " +
    'are neglected. Reply ONLY with JSON: {"items":["<key>",…],"why":"one short sentence"}. ' +
    "Use only keys from the menu. Keep total estMin at or under the budget unless an item is due.";
  const user = JSON.stringify({ budgetMin, candidates: rows });
  return { system, user };
}

/**
 * Parse the model's reply into validated keys. Forgiving: tolerates code fences and
 * extra prose, drops unknown keys, dedupes. Returns null if nothing usable.
 */
export function parseChoice(text, validKeys) {
  if (!text) {
    return null;
  }
  let obj = null;
  try {
    obj = JSON.parse(text);
  } catch {
    const m = String(text).match(/\{[\s\S]*\}/); // first {...} block
    if (m) {
      try {
        obj = JSON.parse(m[0]);
      } catch {
        return null;
      }
    }
  }
  if (!obj || !Array.isArray(obj.items)) {
    return null;
  }
  const seen = new Set();
  const ids = [];
  for (const k of obj.items) {
    if (typeof k === "string" && validKeys.has(k) && !seen.has(k)) {
      seen.add(k);
      ids.push(k);
    }
  }
  if (!ids.length) {
    return null;
  }
  const why = typeof obj.why === "string" ? obj.why.trim().slice(0, 200) : "";
  return { ids, why };
}

/**
 * Refine the planner's draft with the local model. Always resolves to a plan object;
 * on any failure returns `draft` unchanged (with no `source: "ai"`).
 * @param deps injectable transport for tests ({ fetch })
 */
export async function refinePlan(state, draft, opts = {}, deps = {}) {
  if (!aiEnabled()) {
    return draft;
  }
  const cfg = aiConfig();
  const doFetch = deps.fetch || globalThis.fetch;
  const today = opts.today || draft.day;
  const budgetMin = opts.budgetMin ?? draft.budgetMin;

  const { rows, byKey } = buildCandidates(state, {
    today,
    taskDefaultMin: opts.taskDefaultMin,
    defaultStepMin: opts.defaultStepMin,
  });
  if (!rows.length) {
    return draft;
  }
  const { system, user } = buildMessages(rows, budgetMin);

  try {
    const res = await doFetch(`${cfg.url}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: cfg.model,
        stream: false,
        format: "json",
        options: { temperature: 0.2 },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(opts.timeoutMs || 20000),
    });
    if (!res.ok) {
      return draft;
    }
    const data = await res.json();
    const choice = parseChoice(data?.message?.content, new Set(byKey.keys()));
    if (!choice) {
      return draft;
    }
    const items = choice.ids.map((k) => ({ ...byKey.get(k), reason: "ai" }));
    const plannedMin = items.reduce((n, it) => n + (it.estMin || 0), 0);
    return {
      day: today,
      budgetMin,
      plannedMin,
      overflow: plannedMin > budgetMin,
      items,
      counts: draft.counts,
      why: choice.why || draft.why,
      source: "ai",
      model: cfg.model,
    };
  } catch {
    return draft; // unreachable / timeout / bad JSON → deterministic plan stands
  }
}
