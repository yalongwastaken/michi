import { Flame, Trophy, CalendarCheck, Rocket, Snowflake, Check, Milestone } from "lucide-react";
import { Card, Badge, ProgressBar, EmptyState } from "../ui.jsx";
import { shortDate, formatMeters } from "../lib/format.js";
import Mascot from "./Mascot.jsx";

// mirrors server/engine.js WAYPOINTS — the xp payload carries the *current* waypoint
// name only, so the "next waypoint" caption resolves the following one client-side
const WAYPOINTS = [
  "Trailhead",
  "First Marker",
  "Mossy Steps",
  "Stream Crossing",
  "Bamboo Grove",
  "Stone Lantern",
  "Mountain Gate",
  "Cedar Pass",
  "High Meadow",
  "Cloud Line",
  "Ridge Walk",
  "Summit",
];
// tiny roman-numeral formatter for waypoint "laps" — an exact mirror of
// server/engine.js roman(), so client and server names can never drift
function roman(n) {
  const table = [
    [1000, "M"],
    [900, "CM"],
    [500, "D"],
    [400, "CD"],
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let out = "";
  for (const [v, sym] of table) {
    while (n >= v) {
      out += sym;
      n -= v;
    }
  }
  return out;
}

function nextWaypointName(level) {
  const n = level + 1;
  const name = WAYPOINTS[n % WAYPOINTS.length];
  const lap = Math.floor(n / WAYPOINTS.length);
  return lap ? `${name} ${roman(lap + 1)}` : name;
}

// waypoint/level card: how far along the trail you are, and what's next
function WaypointCard({ xp }) {
  const pct = Math.max(0, Math.min(100, xp.progressPct));
  const toGo = Math.max(0, xp.nextLevelM - xp.totalM);
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 dark:text-slate-200">
            <Milestone size={15} className="shrink-0 text-trail-600" />
            <span className="truncate">{xp.name}</span>
            <Badge className="bg-iris-500/15 text-iris-600 dark:text-iris-300">Lv {xp.level}</Badge>
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">
            {formatMeters(toGo)} to {nextWaypointName(xp.level)}
            {xp.todayM > 0 ? (
              <span className="ml-1.5 font-medium text-trail-600 dark:text-trail-400">
                +{xp.todayM} m today
              </span>
            ) : null}
          </p>
        </div>
        <div className="-my-1 shrink-0">
          <Mascot mood={xp.todayM > 0 ? "happy" : "neutral"} size={48} />
        </div>
      </div>
      <div className="relative mt-3" aria-hidden="true">
        <div className="h-2.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
          <div
            className="h-full rounded-full bg-gradient-to-r from-trail-500 to-iris-500 transition-[width] duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span
          className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-trail-600 dark:border-slate-900"
          style={{ left: `${pct}%` }}
        />
      </div>
      <div className="mt-1.5 flex justify-between text-xs text-slate-400">
        <span>{formatMeters(xp.levelStartM)}</span>
        <span className="font-medium text-slate-500 dark:text-slate-400">
          {formatMeters(xp.totalM)} walked
        </span>
        <span>{formatMeters(xp.nextLevelM)}</span>
      </div>
    </Card>
  );
}

// one badge per streak milestone — earned fills iris, the rest wait as dashed outlines
function BadgeRow({ milestones }) {
  if (!milestones?.length) {
    return null;
  }
  return (
    <div>
      <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
        Streak badges
      </h3>
      <Card className="p-4">
        <ul className="flex gap-2.5 overflow-x-auto pb-1" aria-label="Streak badges">
          {milestones.map(({ days, earned }) => (
            <li
              key={days}
              aria-label={`${days}-day streak badge — ${earned ? "earned" : "not yet"}`}
              title={`${days}-day streak${earned ? " — earned" : ""}`}
              className={`flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-full ${
                earned
                  ? "bg-iris-500 text-white shadow-sm"
                  : "border-2 border-dashed border-slate-300 text-slate-400 dark:border-slate-600 dark:text-slate-500"
              }`}
            >
              <Flame
                size={13}
                aria-hidden="true"
                className={earned ? "text-iris-200" : "opacity-60"}
              />
              <span className="text-sm font-bold leading-tight">{days}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-slate-400">
          Earned by your longest streak — once walked, never lost.
        </p>
      </Card>
    </div>
  );
}

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
  const total = heat.reduce((a, c) => a + c.count, 0);
  const activeDays = heat.filter((c) => c.count > 0).length;
  return (
    <div
      role="img"
      aria-label={`Activity over the last ${heat.length} days: ${activeDays} active days, ${total} completed.`}
      className="flex gap-1 overflow-x-auto pb-1"
    >
      {weeks.map((week, wi) => (
        <div key={wi} className="flex flex-col gap-1" aria-hidden="true">
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
  const review = ctx.review;
  const activeRoadmaps = m.roadmaps.filter((r) => !r.archived && r.total > 0);
  // freeze budget: the richer payload when the server sends it, else derived from
  // the streak fields (older servers) so the line never disappears mid-upgrade
  const fz =
    m.freezes ||
    (streak.freezes
      ? {
          total: streak.freezes,
          used: streak.freezesUsed,
          left: streak.freezes - streak.freezesUsed,
          earned: 0,
        }
      : null);

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
          {fz?.total ? (
            <>
              <p className="mt-1 flex items-center gap-1 text-xs text-iris-500">
                <Snowflake size={12} /> {fz.left} of {fz.total} freezes left
              </p>
              {fz.earned > 0 ? (
                <p className="mt-0.5 text-xs font-medium text-iris-500">
                  +{fz.earned} earned on the path
                </p>
              ) : null}
            </>
          ) : null}
        </div>
        <Flame
          size={56}
          className={streak.atRisk ? "text-slate-300" : "text-iris-500"}
          strokeWidth={1.5}
        />
      </Card>

      {m.xp ? <WaypointCard xp={m.xp} /> : null}

      <div className="grid grid-cols-3 gap-2.5">
        <Stat
          icon={Trophy}
          label="longest"
          value={streak.longest}
          tint="bg-iris-50 text-iris-600 dark:bg-iris-950/40"
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

      <BadgeRow milestones={m.milestones} />

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

      {review ? (
        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-600 dark:text-slate-300">
              <CalendarCheck size={15} className="text-trail-600" /> This week
            </h3>
            <span className="text-xs text-slate-500">
              {review.completed} done · {review.activeDays}/{review.days} active days
            </span>
          </div>
          {review.finished.length ? (
            <ul className="space-y-0.5 text-sm text-slate-600 dark:text-slate-300">
              {review.finished.slice(0, 5).map((f, i) => (
                <li key={i} className="flex items-center gap-1.5">
                  <Check size={13} className="shrink-0 text-trail-500" />
                  <span className="truncate">{f.title}</span>
                </li>
              ))}
            </ul>
          ) : review.reflection ? null : ( // the reflection below carries the quiet week
            <p className="text-sm text-slate-500">
              A quiet week on the path so far — one step gets it moving.
            </p>
          )}
          {review.reflection ? (
            <p className="mt-2 text-xs italic text-slate-500 dark:text-slate-400">
              {review.reflection}
            </p>
          ) : null}
          {review.advanced.length ? (
            <p className="mt-2 text-xs text-slate-500">Moved: {review.advanced.join(", ")}</p>
          ) : null}
          {review.slipped.length ? (
            <p className="mt-1 text-xs text-rose-500">Slipped: {review.slipped.join(" · ")}</p>
          ) : null}
        </Card>
      ) : null}

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
