// digest.js — a short, plain-text summary of the day (streak + plan + one nudge).
// Self-hosted-friendly: a cron job on the mini PC can curl /api/digest?format=text and
// pipe it to a local notifier (ntfy, terminal-notifier, notify-send) — no cloud, no
// outbound calls from Michi itself. Pure over the state + planner opts.
import { momentum } from "./engine.js";
import { dayKey } from "./dates.js";
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

/**
 * Build the day's digest. Returns both a plain-text rendering and the structured
 * pieces (so the endpoint can serve text or JSON).
 * @param {Object} state full model
 * @param {Object} [opts] planner opts (today, budgetMin, defaultStepMin, taskDefaultMin, skip)
 */
export function buildDigest(state, opts = {}) {
  const today = opts.today || dayKey();
  const plan = planDay(state, opts);
  const m = momentum(state, { today });
  const nudges = insights(state, { today });
  // belt-and-suspenders: validateState enforces a string name, but a non-string
  // (e.g. a number) from an old backup must not crash the digest
  const name = typeof state.profile?.name === "string" ? state.profile.name.trim() : "";

  const lines = [`Michi — ${dateLabel(today)}${name ? ` · ${name}` : ""}`];

  const st = m.streak;
  if (st.current > 0) {
    lines.push(
      `Streak: ${st.current} day${st.current > 1 ? "s" : ""}${st.atRisk ? " (at risk — do one thing today)" : ""}`,
    );
  } else {
    lines.push("No streak yet — today makes a fine step one.");
  }

  if (plan.items.length) {
    lines.push("");
    lines.push(`Today (~${plan.plannedMin} of ${plan.budgetMin} min):`);
    for (const it of plan.items) {
      const ctx = it.kind === "step" && it.roadmapTitle ? ` — ${it.roadmapTitle}` : "";
      const tag = it.reason && it.reason !== "rotate" ? `  [${it.reason}]` : "";
      lines.push(`  • ${it.title}${ctx}${tag}`);
    }
  } else {
    lines.push("");
    lines.push("Nothing planned — add a task or a roadmap step, and the path appears.");
  }

  if (nudges.length) {
    lines.push("");
    lines.push(`Heads up: ${nudges[0].text}`);
  }

  return { day: today, text: lines.join("\n"), streak: m.streak, plan, insights: nudges };
}
