import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Trash2, Clock, CalendarDays } from "lucide-react";
import { Card, IconButton } from "../ui.jsx";
import { api } from "../lib/api.js";
import { todayKey } from "../lib/format.js";
import { parseQuickLog, minLabel, durLabel } from "../lib/quicklog.js";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const PX_PER_HOUR = 48;

// UTC-noon day math so month/grid never slips a day across time zones
const ymd = (d) => d.toISOString().slice(0, 10);
const dayAt = (s) => new Date(`${s}T12:00:00Z`);
const monthOf = (s) => s.slice(0, 7);
const firstOfMonth = (m) => `${m}-01`;
function addMonth(m, n) {
  const d = dayAt(`${m}-01`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return ymd(d).slice(0, 7);
}
function daysInMonth(m) {
  const d = dayAt(`${m}-01`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return d.getUTCDate();
}
const monthLabel = (m) =>
  dayAt(`${m}-01`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const weekdayDate = (s) =>
  dayAt(s).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

// one timed block, absolutely positioned on the hour grid
function TimedBlock({ e, top, height, color, onDelete }) {
  return (
    <div
      className="absolute left-14 right-1 flex items-start justify-between gap-2 overflow-hidden rounded-lg border-l-2 px-2 py-1"
      style={{
        top,
        height,
        borderColor: color,
        background: `${color}1a`, // ~10% tint
      }}
    >
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-slate-800 dark:text-slate-100">{e.title}</p>
        <p className="text-[10px] text-slate-500 dark:text-slate-400">
          {minLabel(e.startMin)}
          {e.endMin != null ? `–${minLabel(e.endMin)}` : ""}
        </p>
      </div>
      <button
        onClick={() => onDelete(e)}
        aria-label={`Delete ${e.title}`}
        className="shrink-0 text-slate-300 transition hover:text-rose-500 dark:text-slate-600"
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}

function Timeline({ entries, onDelete }) {
  const timed = entries.filter((e) => e.startMin != null);
  if (timed.length === 0) {
    return null;
  }
  const startHour = Math.max(0, Math.floor(Math.min(...timed.map((e) => e.startMin)) / 60) - 0);
  const endHour = Math.min(
    24,
    Math.ceil(Math.max(...timed.map((e) => e.endMin ?? e.startMin + 30)) / 60) + 1,
  );
  const hours = [];
  for (let h = startHour; h < endHour; h++) {
    hours.push(h);
  }
  const height = (endHour - startHour) * PX_PER_HOUR;
  const topOf = (min) => ((min - startHour * 60) / 60) * PX_PER_HOUR;

  return (
    <div className="relative mt-2" style={{ height }}>
      {hours.map((h, i) => (
        <div
          key={h}
          className="absolute left-0 right-0 border-t border-slate-100 dark:border-slate-800"
          style={{ top: i * PX_PER_HOUR }}
        >
          <span className="absolute -top-2 left-0 w-12 pr-2 text-right text-[10px] text-slate-400">
            {minLabel(h * 60).replace(":00", "")}
          </span>
        </div>
      ))}
      {timed.map((e) => (
        <TimedBlock
          key={e.id}
          e={e}
          top={topOf(e.startMin)}
          height={Math.max((((e.endMin ?? e.startMin + 30) - e.startMin) / 60) * PX_PER_HOUR, 22)}
          color="#4E8640"
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

export default function Journal({ ctx }) {
  const [cursor, setCursor] = useState(() => monthOf(todayKey()));
  const [selected, setSelected] = useState(() => todayKey());
  const [entries, setEntries] = useState([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);

  const load = async (month) => {
    const from = firstOfMonth(month);
    const to = `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;
    try {
      const { entries: rows } = await api.journal.list(from, to);
      setEntries(rows || []);
    } catch {
      setEntries([]);
    }
  };
  useEffect(() => {
    load(cursor);
  }, [cursor]);

  const byDay = useMemo(() => {
    const m = new Map();
    for (const e of entries) {
      const list = m.get(e.day) || [];
      list.push(e);
      m.set(e.day, list);
    }
    return m;
  }, [entries]);

  const dayMinutes = (day) =>
    (byDay.get(day) || []).reduce(
      (n, e) => n + (e.endMin != null && e.startMin != null ? e.endMin - e.startMin : 0),
      0,
    );

  // month grid, padded to whole weeks (Sunday-first)
  const grid = useMemo(() => {
    const total = daysInMonth(cursor);
    const lead = dayAt(firstOfMonth(cursor)).getUTCDay();
    const cells = Array(lead).fill(null);
    for (let d = 1; d <= total; d++) {
      cells.push(`${cursor}-${String(d).padStart(2, "0")}`);
    }
    while (cells.length % 7 !== 0) {
      cells.push(null);
    }
    return cells;
  }, [cursor]);

  const selectedEntries = (byDay.get(selected) || [])
    .slice()
    .sort((a, b) => (a.startMin ?? 1e9) - (b.startMin ?? 1e9));
  const untimed = selectedEntries.filter((e) => e.startMin == null);
  const total = dayMinutes(selected);
  const today = todayKey();

  const projectName = (id) => (ctx.state?.projects || []).find((p) => p.id === id)?.title;

  const addLog = async (e) => {
    e.preventDefault();
    if (submitting.current || !text.trim()) {
      return;
    }
    const parsed = parseQuickLog(text);
    const title = parsed.title || text.trim();
    submitting.current = true;
    setBusy(true);
    try {
      await api.journal.add({
        day: selected,
        title,
        startMin: parsed.startMin,
        endMin: parsed.endMin,
      });
      setText("");
      await load(cursor);
    } catch {
      /* keep the text so the user can retry */
    }
    submitting.current = false;
    setBusy(false);
  };

  const remove = async (entry) => {
    setEntries((rows) => rows.filter((r) => r.id !== entry.id)); // optimistic
    try {
      await api.journal.remove(entry.id);
    } catch {
      load(cursor); // reconcile on failure
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-lg font-semibold text-slate-800 dark:text-slate-100">
          <CalendarDays size={18} className="text-trail-700 dark:text-trail-400" /> Journal
        </h2>
        <div className="flex items-center gap-1">
          <IconButton label="Previous month" onClick={() => setCursor((m) => addMonth(m, -1))}>
            <ChevronLeft size={16} />
          </IconButton>
          <span className="w-32 text-center text-sm font-medium text-slate-600 dark:text-slate-300">
            {monthLabel(cursor)}
          </span>
          <IconButton label="Next month" onClick={() => setCursor((m) => addMonth(m, 1))}>
            <ChevronRight size={16} />
          </IconButton>
        </div>
      </div>

      <Card className="p-3">
        <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase text-slate-400">
          {WEEKDAYS.map((d, i) => (
            <span key={i}>{d}</span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {grid.map((day, i) => {
            if (!day) {
              return <span key={i} />;
            }
            const mins = dayMinutes(day);
            const has = (byDay.get(day) || []).length > 0;
            const isSel = day === selected;
            const isToday = day === today;
            return (
              <button
                key={day}
                onClick={() => setSelected(day)}
                aria-label={`${weekdayDate(day)}${mins ? ` — ${durLabel(mins)} logged` : ""}`}
                aria-current={isSel ? "date" : undefined}
                className={`flex aspect-square flex-col items-center justify-center rounded-lg text-sm transition ${
                  isSel
                    ? "bg-trail-600 font-semibold text-white"
                    : isToday
                      ? "bg-trail-50 text-trail-700 dark:bg-slate-800 dark:text-trail-300"
                      : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                }`}
              >
                {Number(day.slice(-2))}
                <span
                  aria-hidden="true"
                  className={`mt-0.5 h-1 w-1 rounded-full ${
                    has ? (isSel ? "bg-white" : "bg-trail-500") : "bg-transparent"
                  }`}
                />
              </button>
            );
          })}
        </div>
      </Card>

      <div>
        <div className="mb-1.5 flex items-baseline justify-between px-1">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            {selected === today ? "Today" : weekdayDate(selected)}
          </h3>
          {total > 0 ? (
            <span className="text-xs text-slate-500">{durLabel(total)} logged</span>
          ) : null}
        </div>

        <Card className="p-3">
          {/* one-field logging, right where you're looking — no extra taps */}
          <form onSubmit={addLog} className="flex gap-2">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Log what you did… e.g. “studied SPI 9-11”"
              aria-label="Log an entry"
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-trail-400 focus:outline-none focus:ring-2 focus:ring-trail-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-trail-800"
            />
            <button
              type="submit"
              disabled={busy || !text.trim()}
              aria-label="Add log entry"
              className="shrink-0 rounded-xl bg-trail-600 px-3 text-white transition hover:bg-trail-700 disabled:opacity-50"
            >
              <Plus size={16} />
            </button>
          </form>

          {selectedEntries.length === 0 ? (
            <p className="mt-3 text-center text-sm text-slate-400">
              Nothing logged yet — jot what you did above.
            </p>
          ) : (
            <>
              {untimed.length ? (
                <ul className="mt-3 space-y-1">
                  {untimed.map((e) => (
                    <li
                      key={e.id}
                      className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 dark:bg-slate-800/60"
                    >
                      <span className="min-w-0">
                        <span className="truncate text-sm text-slate-700 dark:text-slate-200">
                          {e.title}
                        </span>
                        {e.minutes || projectName(e.projectId) ? (
                          <span className="ml-1.5 text-xs text-slate-400">
                            {[projectName(e.projectId), durLabel(e.minutes)]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        ) : null}
                      </span>
                      <button
                        onClick={() => remove(e)}
                        aria-label={`Delete ${e.title}`}
                        className="shrink-0 text-slate-300 transition hover:text-rose-500 dark:text-slate-600"
                      >
                        <Trash2 size={13} />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <Timeline entries={selectedEntries} onDelete={remove} />
              {untimed.length === selectedEntries.length ? (
                <p className="mt-2 flex items-center gap-1 px-1 text-[11px] text-slate-400">
                  <Clock size={11} /> add a time like “9-11” to place it on the timeline
                </p>
              ) : null}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
