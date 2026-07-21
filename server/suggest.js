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
import { recurringDueToday } from "./engine.js";
import { localDay } from "./dates.js";
import { stepLine, taskLine } from "./project.js";

/** Is the local model layer turned on? On by default — only an explicit off value
 * (0/false/off/no) disables it. Calls still fail gracefully when Ollama is down,
 * so "on" without a running model just falls back to the deterministic paths. */
export function aiEnabled() {
  return !/^(0|false|off|no)$/i.test(String(process.env.MICHI_LLM ?? "").trim());
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
  // bucket by local day (matches planner/engine) — a raw UTC slice would mis-file
  // evening completions west of UTC and re-offer a done task to the model
  const isDoneToday = (t) => t.status === "done" && localDay(t.doneAt) === today;
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
      taskLine(t, { estMin }), // shared client shape (see project.js)
    );
  }

  const roadmaps = (state.roadmaps || []).filter((r) => !r.archived);
  const milestones = state.milestones || [];
  const steps = state.steps || [];
  // per-roadmap step estimate when set, else the global default (mirrors planner.js)
  const stepCost = (r) =>
    Number.isFinite(Number(r.stepMinutes)) && Number(r.stepMinutes) > 0
      ? Number(r.stepMinutes)
      : defaultStepMin;
  for (const r of roadmaps) {
    const rms = milestones
      .filter((m) => m.roadmapId === r.id)
      .sort((a, b) => a.position - b.position);
    const rStepMin = stepCost(r);
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
            estMin: rStepMin,
          },
          stepLine(s, m, r, { estMin: rStepMin }), // shared client shape (see project.js)
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
 * Reason buckets for a refined item set (mirrors planner.js's counts shape). The
 * draft's counts describe a *different* item selection, so they must be recomputed
 * from what the model actually picked. `pace` stays 0 — the model doesn't pace.
 */
function countItems(items, today) {
  const counts = { due: 0, pace: 0, continue: 0, rotate: 0 };
  for (const it of items) {
    const isDue =
      it.kind === "task" &&
      (it.recurrence ? recurringDueToday(it, today) : !!(it.due && it.due <= today));
    if (isDue) {
      counts.due += 1;
    } else if (it.status === "doing") {
      counts.continue += 1;
    } else {
      counts.rotate += 1;
    }
  }
  return counts;
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

  // resolve against the base so a stray path/query in MICHI_LLM_URL can't mangle the
  // endpoint (defense-in-depth; the URL is operator-set, never request-controlled)
  let endpoint;
  try {
    endpoint = new URL("/api/chat", cfg.url).toString();
  } catch {
    return draft; // a malformed MICHI_LLM_URL shouldn't 500 the request
  }

  try {
    const res = await doFetch(endpoint, {
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
      counts: countItems(items, today),
      why: choice.why || draft.why,
      source: "ai",
      model: cfg.model,
    };
  } catch {
    return draft; // unreachable / timeout / bad JSON → deterministic plan stands
  }
}
