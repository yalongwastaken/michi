// dates.js — the one home for local-calendar-day math. Everything in Michi works
// on YYYY-MM-DD strings bucketed by the *local* timezone (the mini PC runs in the
// user's tz), and all arithmetic pins midday UTC so DST / tz offsets can never
// shift the calendar day. engine.js, planner.js, insights.js, review.js and db.js
// each used to carry hand-synced copies of these; they live here now.

/** Local YYYY-MM-DD for a Date (server-local; the client may pass its own day). */
export function dayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Local calendar day (YYYY-MM-DD) for a stored ISO timestamp, or null when absent.
 * done_at is stamped in UTC, but everything the user sees is bucketed by *their*
 * day — slicing the raw UTC string would mis-file evening completions for anyone
 * west of UTC.
 */
export function localDay(iso) {
  return iso ? dayKey(new Date(iso)) : null;
}

/** Day-of-week 0..6 (Sun..Sat) for a YYYY-MM-DD string, in a tz-stable way. */
export function dow(dayStr) {
  // append midday UTC so DST / tz never shifts the calendar day
  return new Date(`${dayStr}T12:00:00Z`).getUTCDay();
}

/** Shift a YYYY-MM-DD string by `n` calendar days (`n` may be negative). */
export function shiftDay(day, n) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Step back one calendar day from a YYYY-MM-DD string. */
export function prevDay(day) {
  return shiftDay(day, -1);
}

/**
 * Days from `today` until `target`, inclusive of today (a deadline today → 1), or
 * null when there is no target. Callers differ on purpose about what a past date
 * means: the planner clamps to ≥ 1 ("a deadline today or past means all of it,
 * now"), while insights keep the raw (possibly ≤ 0) value to detect roadmaps that
 * already slipped past their finish date — hence the `clamp` option.
 */
export function daysUntil(target, today, { clamp = false } = {}) {
  if (!target) {
    return null;
  }
  const diff =
    Math.round((Date.parse(`${target}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000) +
    1;
  return clamp ? Math.max(1, diff) : diff;
}

/** Whole days from `from` up to `day` (both YYYY-MM-DD); null if `from` missing. */
export function daysSince(from, day) {
  if (!from) {
    return null;
  }
  return Math.round((Date.parse(`${day}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000);
}
