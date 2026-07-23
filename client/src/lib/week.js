// week.js — Monday-anchored week helpers for the weekly-plan layer. Pure, noon-UTC
// anchored like format.js so DST never skips a day. Weeks run Mon→Sun (the day-split
// keys a week_plan carries), matching the server's WEEKDAY_KEYS.
import { addDays, shortDate } from "./format.js";

export const WEEKDAYS = [
  { key: "mon", label: "Mon" },
  { key: "tue", label: "Tue" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "Sat" },
  { key: "sun", label: "Sun" },
];

const mondayIndex = (day) => (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7; // Mon=0…Sun=6

/** The Monday (YYYY-MM-DD) of the week containing `day`. */
export function weekStartOf(day) {
  return addDays(day, -mondayIndex(day));
}

/** The weekday key ("mon".."sun") for a YYYY-MM-DD date. */
export function weekdayKeyOf(day) {
  return WEEKDAYS[mondayIndex(day)].key;
}

/** [{ key, label, date }] for Mon→Sun of the week starting at `weekStart`. */
export function weekDays(weekStart) {
  return WEEKDAYS.map((w, i) => ({ ...w, date: addDays(weekStart, i) }));
}

/** A friendly "20 Jun – 26 Jun" label for the week starting at `weekStart`. */
export function weekLabel(weekStart) {
  return `${shortDate(weekStart)} – ${shortDate(addDays(weekStart, 6))}`;
}
