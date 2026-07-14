import {
  Trophy,
  CalendarCheck,
  Rocket,
  Snowflake,
  Check,
  Circle,
  Sun,
  ChevronRight,
} from "lucide-react";
import { Card, Badge } from "../ui.jsx";
import { shortDate } from "../lib/format.js";
import CoachBubble from "./CoachBubble.jsx";

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

// the streak hero — day count, freeze budget, and the companion carrying the
// streak's temperature (on fire from a week in, drowsy when today would break it)
function StreakCard({ streak, fz, species }) {
  return (
    <Card className="flex items-center justify-between gap-3 p-4 !bg-trail-50 !ring-trail-100 dark:!bg-trail-950/40 dark:!ring-trail-900/50">
      <div className="shrink-0">
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-extrabold text-slate-800 dark:text-white">
            {streak.current}
          </span>
          <span className="text-sm font-medium text-slate-500">day streak</span>
        </div>
        {fz?.total ? (
          <>
            <p className="mt-1 flex items-center gap-1 text-xs text-iris-500 dark:text-iris-300">
              <Snowflake size={12} /> {fz.left} of {fz.total} freezes left
            </p>
            {fz.earned > 0 ? (
              <p className="mt-0.5 text-xs font-medium text-iris-500 dark:text-iris-300">
                +{fz.earned} earned on the path
              </p>
            ) : null}
          </>
        ) : null}
      </div>
      <CoachBubble
        species={species}
        mood={streak.atRisk ? "sleepy" : streak.current >= 7 ? "fire" : "idle"}
        size={64}
        side="right"
      >
        {streak.atRisk
          ? "one small thing keeps it alive."
          : streak.current > 0
            ? `${streak.current} day${streak.current === 1 ? "" : "s"} on the path.`
            : "today makes a fine step one."}
      </CoachBubble>
    </Card>
  );
}

// today at a glance — the day's twin of the "This week" card below. Goal progress,
// what's still planned, and a jump into the full Today screen. Read-only: ticking
// happens on the Today tab, this is the dashboard summary.
function DaySection({ ctx, species }) {
  const { momentum: m, plan, today, setTab } = ctx;
  const goal = m?.dailyGoal ?? 3;
  const did = m?.todayCount ?? 0;
  const met = goal > 0 && did >= goal;
  const pct = goal > 0 ? Math.min(100, Math.round((did / goal) * 100)) : 0;
  const remaining = (plan?.items || []).filter((it) => it.status !== "done");
  const dayKey = today?.day || ctx.day;

  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-600 dark:text-slate-300">
          <Sun size={15} className="text-trail-700 dark:text-trail-400" /> Today
          {dayKey ? (
            <span className="font-normal text-slate-400">· {shortDate(dayKey)}</span>
          ) : null}
        </h3>
        <span className="text-xs text-slate-500">
          {did} of {goal} done
          {met ? (
            <Badge className="ml-1.5 bg-iris-500/15 text-iris-600 dark:text-iris-300">
              goal met
            </Badge>
          ) : null}
        </span>
      </div>

      <div
        className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
        role="img"
        aria-label={`${did} of ${goal} done today`}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${met ? "bg-iris-500" : "bg-trail-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {remaining.length ? (
        <ul className="mt-3 space-y-0.5 text-sm text-slate-600 dark:text-slate-300">
          {remaining.slice(0, 4).map((it) => (
            <li key={`${it.kind}_${it.id}`} className="flex items-center gap-1.5">
              <Circle size={13} className="shrink-0 text-slate-300 dark:text-slate-600" />
              <span className="truncate">{it.title}</span>
            </li>
          ))}
          {remaining.length > 4 ? (
            <li className="pl-[19px] text-xs text-slate-400">+{remaining.length - 4} more</li>
          ) : null}
        </ul>
      ) : (
        <div className="mt-3">
          <CoachBubble species={species} mood={met ? "celebrate" : "idle"} size={40} side="left">
            {met
              ? "the day's plan is walked — nicely done."
              : "nothing planned yet — line one up on Today."}
          </CoachBubble>
        </div>
      )}

      <button
        onClick={() => setTab("today")}
        className="mt-3 flex w-full items-center justify-center gap-1 rounded-lg py-2 text-xs font-medium text-slate-500 transition hover:bg-slate-100 hover:text-trail-700 dark:hover:bg-slate-800 dark:hover:text-trail-400"
      >
        Open today <ChevronRight size={14} />
      </button>
    </Card>
  );
}

// the "This week" review — completed count, what got finished, the coach's
// reflection, and what moved or slipped
function WeekCard({ review, settings, species }) {
  const wGoal = settings.weeklyGoal ?? 15;
  const wDays = settings.weeklyActiveDays ?? 5;
  const met = wGoal > 0 && review.completed >= wGoal;
  const pct = wGoal > 0 ? Math.min(100, Math.round((review.completed / wGoal) * 100)) : 0;
  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-600 dark:text-slate-300">
          <CalendarCheck size={15} className="text-trail-700 dark:text-trail-400" /> This week
        </h3>
        <span className="text-xs text-slate-500">
          {review.completed}/{wGoal} done · {review.activeDays}/{wDays} days
          {met ? (
            <Badge className="ml-1.5 bg-iris-500/15 text-iris-600 dark:text-iris-300">
              goal met
            </Badge>
          ) : null}
        </span>
      </div>

      <div
        className="mb-3 h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
        role="img"
        aria-label={`${review.completed} of ${wGoal} done this week`}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${met ? "bg-iris-500" : "bg-trail-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {review.finished.length ? (
        <ul className="space-y-0.5 text-sm text-slate-600 dark:text-slate-300">
          {review.finished.slice(0, 5).map((f, i) => (
            <li key={i} className="flex items-center gap-1.5">
              <Check size={13} className="shrink-0 text-trail-600 dark:text-trail-400" />
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
        <div className="mt-2.5">
          {/* the payload carries no pace flag — the pace-up branches are the
              only reflections that say "last week's pace" (server/review.js) */}
          <CoachBubble
            species={species}
            mood={/last week's pace/.test(review.reflection) ? "happy" : "idle"}
            size={36}
            side="left"
          >
            {review.reflection}
          </CoachBubble>
        </div>
      ) : null}
      {review.advanced.length ? (
        <p className="mt-2 text-xs text-slate-500">Moved: {review.advanced.join(", ")}</p>
      ) : null}
      {review.slipped.length ? (
        <p className="mt-1 text-xs text-rose-500">Slipped: {review.slipped.join(" · ")}</p>
      ) : null}
    </Card>
  );
}

// Home — the landing dashboard: the streak, today at a glance, the week in review,
// the headline stats, and the activity heatmap. The leveling journey lives on the
// Progression tab; the day's editable plan lives on Today.
export default function Home({ ctx }) {
  const m = ctx.momentum;
  if (!m) {
    return null;
  }
  const { streak } = m;
  const species = ctx.state?.profile?.mascot;
  const review = ctx.review;
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
      <StreakCard streak={streak} fz={fz} species={species} />

      <DaySection ctx={ctx} species={species} />

      {review ? (
        <WeekCard review={review} settings={ctx.state?.settings || {}} species={species} />
      ) : null}

      <div className="grid grid-cols-3 gap-2.5">
        <Stat
          icon={Trophy}
          label="longest"
          value={streak.longest}
          tint="bg-iris-50 text-iris-600 dark:bg-iris-950/40 dark:text-iris-300"
        />
        <Stat
          icon={CalendarCheck}
          label="active days"
          value={m.daysActive}
          tint="bg-trail-50 text-trail-700 dark:bg-slate-800 dark:text-trail-300"
        />
        <Stat
          icon={Rocket}
          label="shipped"
          value={m.projects.shipped}
          tint="bg-iris-50 text-iris-600 dark:bg-iris-950/40 dark:text-iris-300"
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
    </div>
  );
}
