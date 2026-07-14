// digest.js — a short, plain-text summary for a cron job (streak + plan + one nudge).
// Self-hosted-friendly: a cron job on the mini PC can curl /api/digest?format=text and
// pipe it to a local notifier (ntfy, terminal-notifier, notify-send) — no cloud, no
// outbound calls from Michi itself. Pure over the state + planner opts.
//
// Two moods: "morning" (default) looks forward — today's plan and one nudge.
// "evening" looks back — what got done, whether the streak held, and a small
// glimpse of tomorrow so the day can end settled.
import { momentum, isClean } from "./engine.js";
import { dayKey, shiftDay } from "./dates.js";
import { planDay } from "./planner.js";
import { insights } from "./insights.js";

function dateLabel(day) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// one plan item as a digest line: "  • GPIO — Embedded  [due]"
function planLine(it) {
  const ctx = it.kind === "step" && it.roadmapTitle ? ` — ${it.roadmapTitle}` : "";
  const tag = it.reason && it.reason !== "rotate" ? `  [${it.reason}]` : "";
  return `  • ${it.title}${ctx}${tag}`;
}

// the header line both modes open with
function header(today, name, mode) {
  const suffix = mode === "evening" ? " · evening" : "";
  return `Michi — ${dateLabel(today)}${suffix}${name ? ` · ${name}` : ""}`;
}

// ── kata: the daily forms, summarized for both moods ────────────────────────────
// absent `active` counts as active, matching the model default (see db.js)
const activeKata = (state) =>
  (state.kata || []).filter((k) => k.active !== false && k.active !== 0);

/** Tonight's kata standing: honored/total vs the current active set, clean vs the
 * day's SNAPSHOT (set changed mid-day → the snapshot wins, like everywhere else). */
function kataEvening(state, today) {
  const active = activeKata(state);
  if (active.length === 0) {
    return null;
  }
  const row = (state.kataDays || []).find((r) => r.day === today) || null;
  const honoredSet = new Set(row?.honoredIds || []);
  const honored = active.filter((k) => honoredSet.has(k.id));
  const open = active.find((k) => !honoredSet.has(k.id));
  return {
    honored: honored.length,
    total: active.length,
    clean: isClean(row),
    line: isClean(row)
      ? "Kata: a clean day — 型 held."
      : `Kata: ${honored.length} of ${active.length} honored${open ? ` — ${open.title} still open` : ""}.`,
  };
}

// morning: streak state + the day's forms + the plan + one nudge
function morningLines(lines, m, plan, nudges, kataTitles) {
  const st = m.streak;
  if (st.current > 0) {
    lines.push(
      `Streak: ${st.current} day${st.current > 1 ? "s" : ""}${st.atRisk ? " (at risk — do one thing today)" : ""}`,
    );
  } else {
    lines.push("No streak yet — today makes a fine step one.");
  }

  if (kataTitles.length) {
    lines.push(`Kata: ${kataTitles.join(" · ")}`);
  }

  if (plan.items.length) {
    lines.push("");
    lines.push(`Today (~${plan.plannedMin} of ${plan.budgetMin} min):`);
    for (const it of plan.items) {
      lines.push(planLine(it));
    }
  } else {
    lines.push("");
    lines.push("Nothing planned — add a task or a roadmap step, and the path appears.");
  }

  if (nudges.length) {
    lines.push("");
    lines.push(`Heads up: ${nudges[0].text}`);
  }
}

// evening: what happened today + how the streak stands tonight + tomorrow's glimpse
function eveningLines(lines, m, tomorrow, kata) {
  if (m.todayCount > 0) {
    lines.push(
      `Today: ${m.todayCount} done · +${m.xp.todayM} m on the path${m.metGoal ? " · goal met" : ""}`,
    );
  } else {
    lines.push("Today: nothing checked off — it happens.");
  }

  const st = m.streak;
  const left = st.freezes - st.freezesUsed;
  if (m.todayCount > 0) {
    lines.push(`Streak: ${st.current} day${st.current > 1 ? "s" : ""} — kept.`);
  } else if (st.current > 0 && left > 0) {
    // covering today spends one — report what actually remains after tonight
    lines.push(
      `Streak: ${st.current} day${st.current > 1 ? "s" : ""} — a freeze will cover today (${left - 1} left after).`,
    );
  } else if (st.current > 0) {
    lines.push(
      `Streak: ${st.current} day${st.current > 1 ? "s" : ""} — at risk; one small thing before bed keeps it.`,
    );
  } else {
    lines.push("No streak on the line — tomorrow starts one.");
  }

  if (kata) {
    lines.push(kata.line);
  }

  lines.push("");
  if (tomorrow.length) {
    lines.push("Tomorrow:");
    for (const it of tomorrow) {
      lines.push(planLine(it));
    }
  } else {
    lines.push("Tomorrow is open — pick one step tonight and it'll be waiting.");
  }
}

/**
 * Build the day's digest. Returns both a plain-text rendering and the structured
 * pieces (so the endpoint can serve text or JSON).
 * @param {Object} state full model
 * @param {Object} [opts] planner opts (today, budgetMin, defaultStepMin, taskDefaultMin,
 *   skip) plus `mode`: "morning" (default) or "evening"
 */
export function buildDigest(state, opts = {}) {
  const mode = opts.mode === "evening" ? "evening" : "morning";
  const today = opts.today || dayKey();
  const m = momentum(state, { today });
  // belt-and-suspenders: validateState enforces a string name, but a non-string
  // (e.g. a number) from an old backup must not crash the digest
  const name = typeof state.profile?.name === "string" ? state.profile.name.trim() : "";

  const lines = [header(today, name, mode)];

  if (mode === "evening") {
    // tomorrow's glimpse: plan tomorrow with a clean slate (today's "not today"
    // skips are day-keyed and don't apply) — the planner already puts overdue and
    // due-tomorrow tasks first, then the next steps on the path
    const tomorrow = planDay(state, { ...opts, today: shiftDay(today, 1), skip: [] }).items.slice(
      0,
      3,
    );
    const kata = kataEvening(state, today);
    eveningLines(lines, m, tomorrow, kata);
    return {
      day: today,
      mode,
      text: lines.join("\n"),
      streak: m.streak,
      today: { done: m.todayCount, meters: m.xp.todayM, metGoal: m.metGoal },
      kata: kata ? { honored: kata.honored, total: kata.total, clean: kata.clean } : null,
      tomorrow,
    };
  }

  const plan = planDay(state, opts);
  const nudges = insights(state, { today });
  const kataTitles = activeKata(state).map((k) => k.title);
  morningLines(lines, m, plan, nudges, kataTitles);
  return {
    day: today,
    mode,
    text: lines.join("\n"),
    streak: m.streak,
    kata: kataTitles,
    plan,
    insights: nudges,
  };
}
