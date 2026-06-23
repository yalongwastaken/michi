import { Flame, Trophy, CalendarCheck, Rocket, Snowflake } from "lucide-react";
import { Card, ProgressBar, EmptyState } from "../ui.jsx";
import { shortDate } from "../lib/format.js";

function heatColor(count) {
  if (!count) {
    return "bg-slate-100 dark:bg-slate-800";
  }
  if (count === 1) {
    return "bg-trail-200 dark:bg-trail-900";
  }
  if (count === 2) {
    return "bg-trail-400 dark:bg-trail-700";
  }
  return "bg-trail-600";
}

function Heatmap({ heat = [] }) {
  // pad the front so the first column starts on a Sunday, then chunk into weeks
  const first = heat[0]?.date;
  const lead = first ? new Date(`${first}T12:00:00Z`).getUTCDay() : 0;
  const cells = [...Array(lead).fill(null), ...heat];
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }
  return (
    <div className="flex gap-1 overflow-x-auto pb-1">
      {weeks.map((week, wi) => (
        <div key={wi} className="flex flex-col gap-1">
          {week.map((cell, di) => (
            <div
              key={di}
              title={cell ? `${shortDate(cell.date)} · ${cell.count} done` : ""}
              className={`h-3 w-3 rounded-sm ${cell ? heatColor(cell.count) : "bg-transparent"}`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function Stat({ icon: Icon, label, value, tint }) {
  return (
    <Card className="flex items-center gap-3 p-3">
      <div className={`rounded-xl p-2 ${tint}`}>
        <Icon size={18} />
      </div>
      <div>
        <div className="text-xl font-bold leading-none text-slate-800 dark:text-slate-100">
          {value}
        </div>
        <div className="text-xs text-slate-500">{label}</div>
      </div>
    </Card>
  );
}

export default function Momentum({ ctx }) {
  const m = ctx.momentum;
  if (!m) {
    return null;
  }
  const { streak } = m;
  const activeRoadmaps = m.roadmaps.filter((r) => !r.archived && r.total > 0);

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Momentum</h2>

      <Card className="trail-gradient flex items-center justify-between p-4">
        <div>
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-extrabold text-slate-800 dark:text-white">
              {streak.current}
            </span>
            <span className="text-sm font-medium text-slate-500">day streak</span>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {streak.atRisk
              ? "At risk — do one thing today to keep it alive."
              : m.metGoal
                ? "Goal met today. Nice."
                : `${m.todayCount}/${m.dailyGoal} toward today's goal.`}
          </p>
          {streak.freezes ? (
            <p className="mt-1 inline-flex items-center gap-1 text-xs text-sky-500">
              <Snowflake size={12} /> {streak.freezes - streak.freezesUsed} of {streak.freezes}{" "}
              freezes left
            </p>
          ) : null}
        </div>
        <Flame
          size={56}
          className={streak.atRisk ? "text-slate-300" : "text-ember-500"}
          strokeWidth={1.5}
        />
      </Card>

      <div className="grid grid-cols-3 gap-2.5">
        <Stat
          icon={Trophy}
          label="longest"
          value={streak.longest}
          tint="bg-amber-50 text-amber-500 dark:bg-amber-950/40"
        />
        <Stat
          icon={CalendarCheck}
          label="active days"
          value={m.daysActive}
          tint="bg-trail-50 text-trail-600 dark:bg-slate-800"
        />
        <Stat
          icon={Rocket}
          label="shipped"
          value={m.projects.shipped}
          tint="bg-sky-50 text-sky-600 dark:bg-sky-950/40"
        />
      </div>

      <Card className="p-4">
        <h3 className="mb-3 text-sm font-semibold text-slate-600 dark:text-slate-300">
          Last {m.heat.length} days · {m.totalDone} completed
        </h3>
        <Heatmap heat={m.heat} />
        <div className="mt-2 flex items-center justify-end gap-1 text-xs text-slate-400">
          less
          <span className="h-3 w-3 rounded-sm bg-slate-100 dark:bg-slate-800" />
          <span className="h-3 w-3 rounded-sm bg-trail-200 dark:bg-trail-900" />
          <span className="h-3 w-3 rounded-sm bg-trail-400 dark:bg-trail-700" />
          <span className="h-3 w-3 rounded-sm bg-trail-600" />
          more
        </div>
      </Card>

      <div>
        <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Roadmap progress
        </h3>
        {activeRoadmaps.length === 0 ? (
          <EmptyState title="No roadmap steps yet">
            Add steps to a roadmap and your progress will chart here.
          </EmptyState>
        ) : (
          <Card className="space-y-3 p-4">
            {activeRoadmaps.map((r) => (
              <div key={r.id}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="truncate font-medium text-slate-700 dark:text-slate-200">
                    {r.title}
                  </span>
                  <span className="shrink-0 text-xs text-slate-400">
                    {r.done}/{r.total} · {r.pct}%
                  </span>
                </div>
                <ProgressBar pct={r.pct} color={r.color} />
              </div>
            ))}
          </Card>
        )}
      </div>
    </div>
  );
}
