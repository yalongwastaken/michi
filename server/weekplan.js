// weekplan.js — the Claude round-trip for the WEEK layer (overarching weekly
// schedules), deliberately separate from markdown.js (the item-level sync). A week
// plan is a coarse, whole-thing artifact — targets + a day-split per focus area — so
// applying REPLACES the chosen week wholesale rather than diffing item by item. It
// only ever touches week_plans; roadmaps/tasks/goals/history are passed through
// untouched. Flow mirrors the general sync: export prompt → paste reply → preview →
// apply.
import { getFullState, importAll, validateState } from "./db.js";
import { dayKey } from "./dates.js";

const WEEKDAYS = [
  { key: "mon", label: "Mon" },
  { key: "tue", label: "Tue" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "Sat" },
  { key: "sun", label: "Sun" },
];
// tolerant lookup: full or short weekday name (any case) → canonical key
const DAY_LOOKUP = new Map();
for (const { key } of WEEKDAYS) {
  DAY_LOOKUP.set(key, key);
}
for (const [name, key] of [
  ["monday", "mon"],
  ["tuesday", "tue"],
  ["wednesday", "wed"],
  ["thursday", "thu"],
  ["friday", "fri"],
  ["saturday", "sat"],
  ["sunday", "sun"],
]) {
  DAY_LOOKUP.set(name, key);
}

const uid = (prefix) =>
  `${prefix}_${(globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).slice(0, 8)}`;

const addDays = (day, n) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const weekStartOf = (day) => addDays(day, -((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7));

/**
 * The prompt handed to Claude: context (areas/goals/roadmaps + the week's dates) and
 * the exact reply grammar, then a snapshot of any existing plan for this week to edit.
 */
export function renderWeekExport(state, { weekStart } = {}) {
  const start = weekStartOf(weekStart || dayKey());
  const end = addDays(start, 6);
  const goals = (state.goals || []).filter((g) => g.status !== "achieved");
  const roadmaps = (state.roadmaps || []).filter((r) => !r.archived);
  const plans = (state.weekPlans || []).filter((w) => w.weekStart === start);
  const L = [];

  L.push(
    "You're my coach inside **michi**. Help me plan the WEEK ahead — the overarching",
    "layer above my daily plan. Talk it through with me first, then hand back a plan.",
    "",
    `The week runs ${start} (Mon) → ${end} (Sun).`,
    "",
    "A week plan is organized by *focus area* (e.g. “Japanese”, “Climbing”). Each area",
    "gets a one-line theme, a day-by-day split (what each day is for), and a short list",
    "of weekly targets (concrete outcomes to hit by Sunday).",
    "",
  );

  if (goals.length) {
    L.push("My overarching goals (attach an area to one where it fits):");
    for (const g of goals) {
      L.push(`- ${g.title}${g.area ? ` (${g.area})` : ""}`);
    }
    L.push("");
  }
  if (roadmaps.length) {
    L.push("Learning tracks I have going:");
    for (const r of roadmaps) {
      L.push(`- ${r.title}`);
    }
    L.push("");
  }

  L.push(
    "When you propose the plan, put it in ONE fenced markdown block, following exactly:",
    "",
    "```",
    "## <Area name>",
    "theme: <one line of intent>",
    "goal: <the exact title of one of my goals, or omit>",
    "days:",
    "- Mon: <what Monday is for>",
    "- Tue: <…>   (list only the days that have a focus; skip rest days)",
    "targets:",
    "- [ ] <a concrete outcome for the week>",
    "- [ ] <another>",
    "",
    "## <Another area>",
    "…",
    "```",
    "",
    "- Keep chatting freely OUTSIDE the block. Only what's inside it saves.",
    "- One `## Area` heading per focus area. Repeat the whole shape for each area.",
    "- Applying REPLACES this week's plan entirely with what's in the block, so include",
    "  every area you want the week to have.",
    "",
    "---",
    "",
    `# michi week · ${start}`,
    "",
  );

  if (!plans.length) {
    L.push("(no plan for this week yet — draft one from scratch)");
  } else {
    for (const w of plans) {
      L.push(`## ${w.area}`);
      if (w.theme) {
        L.push(`theme: ${w.theme}`);
      }
      const goal = goals.find((g) => g.id === w.goalId);
      if (goal) {
        L.push(`goal: ${goal.title}`);
      }
      const dayLines = WEEKDAYS.filter((d) => w.days?.[d.key]?.focus);
      if (dayLines.length) {
        L.push("days:");
        for (const d of dayLines) {
          L.push(`- ${d.label}: ${w.days[d.key].focus}`);
        }
      }
      if ((w.targets || []).length) {
        L.push("targets:");
        for (const t of w.targets) {
          L.push(`- [${t.done ? "x" : " "}] ${t.text}`);
        }
      }
      L.push("");
    }
  }

  return L.join("\n");
}

/**
 * Parse Claude's reply into week-plan drafts. Tolerant: reads the first fenced block
 * if present (else the whole text), warns rather than throws.
 * @returns {{plans: Array, warnings: string[]}}
 */
export function parseWeekPlan(markdown, state = {}) {
  const warnings = [];
  let text = String(markdown || "");
  // prefer the first fenced block; fall back to the raw text
  const fence = text.match(/```[^\n]*\n([\s\S]*?)```/);
  if (fence) {
    text = fence[1];
  }
  // drop a pasted-back "# michi week" header line if present
  const lines = text.split("\n").filter((l) => !/^#\s+michi week/i.test(l.trim()));

  const goals = state.goals || [];
  const resolveGoal = (raw) => {
    const v = String(raw || "").trim();
    if (!v) {
      return null;
    }
    const byId = goals.find((g) => g.id === v);
    if (byId) {
      return byId.id;
    }
    const byTitle = goals.find((g) => g.title.toLowerCase() === v.toLowerCase());
    if (byTitle) {
      return byTitle.id;
    }
    warnings.push(`goal "${v}" didn't match any goal — left unlinked`);
    return null;
  };

  const plans = [];
  let cur = null;
  let mode = null; // "days" | "targets" | null
  const flush = () => {
    if (cur && cur.area) {
      plans.push(cur);
    }
    cur = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    const heading = line.match(/^##\s+(.*)$/);
    if (heading) {
      flush();
      // allow "## Area → goal: X" shorthand in the heading; strip the arrow tail
      const area = heading[1].replace(/\s*(→|->).*$/, "").trim();
      cur = { area, theme: null, goalId: null, days: {}, targets: [] };
      mode = null;
      continue;
    }
    if (!cur) {
      continue; // preamble before the first area
    }
    const meta = line.match(/^(theme|goal|days|targets)\s*:\s*(.*)$/i);
    if (meta) {
      const key = meta[1].toLowerCase();
      const val = meta[2].trim();
      if (key === "theme") {
        cur.theme = val || null;
        mode = null;
      } else if (key === "goal") {
        cur.goalId = resolveGoal(val);
        mode = null;
      } else if (key === "days") {
        mode = "days";
        if (val) {
          applyDayLine(cur, val, warnings);
        }
      } else if (key === "targets") {
        mode = "targets";
        if (val) {
          cur.targets.push(parseTarget(val));
        }
      }
      continue;
    }
    // bullet lines belong to the current mode
    const bullet = line.replace(/^[-*]\s+/, "");
    if (mode === "targets") {
      cur.targets.push(parseTarget(bullet));
    } else {
      // default to a day line ("Mon: …") — the common shape
      applyDayLine(cur, bullet, warnings);
    }
  }
  flush();
  return { plans, warnings };
}

function parseTarget(s) {
  const m = String(s).match(/^\[([ xX~])\]\s*(.*)$/);
  if (m) {
    return { text: m[2].trim(), done: m[1].toLowerCase() === "x" };
  }
  return { text: String(s).trim(), done: false };
}

function applyDayLine(cur, s, warnings) {
  const m = String(s).match(/^([A-Za-z]+)\s*:\s*(.*)$/);
  if (!m) {
    return;
  }
  const key = DAY_LOOKUP.get(m[1].toLowerCase());
  if (!key) {
    warnings.push(`unrecognized day "${m[1]}"`);
    return;
  }
  const focus = m[2].trim();
  if (focus) {
    cur.days[key] = { focus };
  }
}

/** A preview summary the endpoint returns before applying. */
export function previewWeekPlan(parsed) {
  return {
    areas: parsed.plans.map((p) => ({
      area: p.area,
      theme: p.theme,
      days: Object.keys(p.days).length,
      targets: p.targets.length,
    })),
    warnings: parsed.warnings,
  };
}

/**
 * Apply the parsed drafts by REPLACING the given week's plans wholesale, then persist
 * atomically via importAll (history preserved). Other weeks are left untouched.
 * @returns {{state, applied:{areas:number}, warnings:string[]}}
 * @throws {Error} when the resulting state would be invalid
 */
export function applyWeekPlan(markdown, { weekStart } = {}) {
  const state = getFullState();
  const start = weekStartOf(weekStart || dayKey());
  const { plans, warnings } = parseWeekPlan(markdown, state);

  const others = (state.weekPlans || []).filter((w) => w.weekStart !== start);
  const fresh = plans.map((p, i) => ({
    id: uid("wk"),
    weekStart: start,
    area: p.area,
    theme: p.theme || null,
    goalId: p.goalId || null,
    days: p.days || {},
    targets: (p.targets || []).map((t) => ({ text: t.text, done: !!t.done })),
    position: i,
    createdAt: new Date().toISOString(),
  }));

  const merged = { ...state, weekPlans: [...others, ...fresh] };
  const bad = validateState(merged);
  if (bad) {
    throw new Error(`week plan would produce an invalid state: ${bad}`);
  }
  const next = importAll(merged);
  return { state: next, applied: { areas: fresh.length }, warnings };
}

/** Did the parse find anything worth applying? (the endpoints 400 otherwise) */
export function hasWeekPlan(parsed) {
  return (parsed.plans || []).length > 0;
}
