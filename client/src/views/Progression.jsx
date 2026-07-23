import { Milestone, Flame } from "lucide-react";
import { Card, Badge, ProgressBar, EmptyState } from "../ui.jsx";
import { formatMeters } from "../lib/format.js";
import Mascot from "./Mascot.jsx";
import Goals from "./Goals.jsx";

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
function WaypointCard({ xp, species }) {
  const pct = Math.max(0, Math.min(100, xp.progressPct));
  const toGo = Math.max(0, xp.nextLevelM - xp.totalM);
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 dark:text-slate-200">
            <Milestone size={15} className="shrink-0 text-trail-700 dark:text-trail-400" />
            <span className="truncate">{xp.name}</span>
            <Badge className="bg-iris-500/15 text-iris-600 dark:text-iris-300">Lv {xp.level}</Badge>
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">
            {formatMeters(toGo)} to {nextWaypointName(xp.level)}
            {xp.todayM > 0 ? (
              <span className="ml-1.5 font-medium text-trail-700 dark:text-trail-400">
                +{xp.todayM} m today
              </span>
            ) : null}
          </p>
        </div>
        <div className="-my-1 shrink-0">
          <Mascot species={species} mood={xp.todayM > 0 ? "happy" : "idle"} size={48} />
        </div>
      </div>
      <div className="relative mt-3" aria-hidden="true">
        <div className="h-2.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
          <div
            className="h-full rounded-full bg-trail-500 transition-[width] duration-500"
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

// grade ring: an iris donut filling toward the next grade, the grade glyph
// centered. Decorative — the caption beside it says the same thing in words.
function GradeRing({ grade }) {
  const pct = Math.max(0, Math.min(100, grade.pct)) / 100;
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 64 64" className="h-16 w-16 shrink-0" aria-hidden="true">
      <circle
        cx="32"
        cy="32"
        r={r}
        fill="none"
        strokeWidth="6"
        className="stroke-slate-200 dark:stroke-slate-700"
      />
      <circle
        cx="32"
        cy="32"
        r={r}
        fill="none"
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={`${c * pct} ${c}`}
        transform="rotate(-90 32 32)"
        className="stroke-iris-500 transition-[stroke-dasharray] duration-500"
      />
      <text
        x="32"
        y="37"
        textAnchor="middle"
        fontSize="14"
        fontWeight="700"
        lang="ja"
        className="fill-slate-700 dark:fill-slate-100"
      >
        {grade.label}
      </text>
    </svg>
  );
}

// the last 7 days of practice, oldest → newest: clean fills iris, partial sits
// lighter, none stays a hairline outline, and today-in-progress is dashed
const WEEK_DOT = {
  clean: "bg-iris-500",
  partial: "bg-iris-200 dark:bg-iris-400/40",
  none: "border border-slate-300 dark:border-slate-600",
  pending: "border border-dashed border-iris-400 dark:border-iris-300",
};

// discipline card: the kyū/dan ladder over clean days — every active kata
// honored — plus the clean streak and a week of dots. Quiet iris, no confetti.
function DisciplineCard({ discipline, species }) {
  const { grade, cleanDays, cleanStreak, week } = discipline;
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <GradeRing grade={grade} />
        <div className="min-w-0 flex-1">
          <h3 className="flex flex-wrap items-center gap-x-1.5 text-sm font-semibold text-slate-700 dark:text-slate-200">
            <span>
              <span lang="ja">{grade.label}</span> · <i>{grade.romaji}</i>
            </span>
            {cleanStreak > 0 ? (
              <Badge className="bg-iris-500/15 text-iris-600 dark:text-iris-300">
                {cleanStreak} day{cleanStreak === 1 ? "" : "s"} clean
              </Badge>
            ) : null}
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">
            {grade.next ? (
              <>
                {cleanDays} clean day{cleanDays === 1 ? "" : "s"} · {grade.next.toGo} to{" "}
                <span lang="ja">{grade.next.label}</span>
              </>
            ) : (
              <>
                <span lang="ja">十段</span> · <i>jūdan</i> — the path continues
              </>
            )}
          </p>
          {/* role="group"/"img" so the labels are actually exposed — a bare span's
              aria-label is ignored by most screen readers */}
          <div className="mt-2 flex gap-1.5" role="group" aria-label="last 7 days of kata">
            {(week || []).map((d) => (
              <span
                key={d.day}
                role="img"
                aria-label={`${d.day}: ${d.state}`}
                title={`${d.day}: ${d.state}`}
                className={`h-3 w-3 rounded-full ${WEEK_DOT[d.state] || WEEK_DOT.none}`}
              />
            ))}
          </div>
        </div>
        {/* a week of held form locks the companion in — same corner as the waypoint card */}
        <div className="-my-1 shrink-0">
          <Mascot species={species} mood={cleanStreak >= 7 ? "locked" : "idle"} size={48} />
        </div>
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

// Progression — the journey/leveling tab: how far along the trail (waypoints),
// how disciplined the practice (dan grade), the streak badges earned, and the
// climb of each active roadmap toward 100%.
export default function Progression({ ctx }) {
  const m = ctx.momentum;
  if (!m) {
    return null;
  }
  const species = ctx.state?.profile?.mascot;
  const activeRoadmaps = m.roadmaps.filter((r) => !r.archived && r.total > 0);

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Progression</h2>

      {m.xp ? <WaypointCard xp={m.xp} species={species} /> : null}

      {/* shown once the practice exists — active kata today, or any clean-day
          history. A brand-new walker isn't greeted with 無級 · 0 clean days. */}
      {m.discipline && ((ctx.kata?.today?.total ?? 0) > 0 || m.discipline.cleanDays > 0) ? (
        <DisciplineCard discipline={m.discipline} species={species} />
      ) : null}

      <BadgeRow milestones={m.milestones} />

      <Goals ctx={ctx} />

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
