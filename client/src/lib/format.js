// format.js — small date/label helpers shared across views. Pure, no deps.

/** Local YYYY-MM-DD for a Date (matches the server's dayKey). */
export function todayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Friendly relative label for a YYYY-MM-DD due date vs today. */
export function dueLabel(due, today = todayKey()) {
  if (!due) {
    return null;
  }
  if (due === today) {
    return "today";
  }
  const a = new Date(`${due}T12:00:00Z`);
  const b = new Date(`${today}T12:00:00Z`);
  const diff = Math.round((a - b) / 86400000);
  if (diff === -1) {
    return "yesterday";
  }
  if (diff === 1) {
    return "tomorrow";
  }
  if (diff < 0) {
    return `${-diff}d overdue`;
  }
  return `in ${diff}d`;
}

/** "23 Jun" style short date. */
export function shortDate(iso) {
  if (!iso) {
    return "";
  }
  const d = new Date(iso.length <= 10 ? `${iso}T12:00:00Z` : iso);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });
}

/** Friendly minutes label, e.g. 90 → "1h 30m". */
export function minutes(min) {
  if (min == null || min === "") {
    return null;
  }
  const n = Number(min);
  if (!Number.isFinite(n) || n <= 0) {
    return null;
  }
  if (n < 60) {
    return `${n}m`;
  }
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}
