// quickadd.js — parse a natural-language task line into structured fields, so typing
// "read SPI docs 30m tomorrow" fills due/estimate/recurrence for you. Pure +
// deterministic (no model). Forgiving: anything it doesn't recognize stays in the title.
import { todayKey } from "./format.js";

const WEEKDAYS = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

/** Shift a YYYY-MM-DD string by n days (tz-stable via midday UTC). */
function addDays(day, n) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Next occurrence of weekday `dow` strictly after `today` (same weekday → +7). */
function nextWeekday(today, dow) {
  const cur = new Date(`${today}T12:00:00Z`).getUTCDay();
  const ahead = (dow - cur + 7) % 7 || 7;
  return addDays(today, ahead);
}

/**
 * @returns {{title:string, due:string|null, estMin:number|null, recurrence:string|null}}
 */
export function parseQuickAdd(input, { today = todayKey() } = {}) {
  let text = ` ${String(input || "")} `;
  let due = null;
  let estMin = null;
  let recurrence = null;

  const strip = (re) => {
    text = text.replace(re, " ");
  };

  // ── duration: "30m", "45 min", "2h", "1 hour" ──
  const dur = text.match(/\b(\d+)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)\b/i);
  if (dur) {
    const n = Number(dur[1]);
    estMin = /^h/i.test(dur[2]) ? n * 60 : n;
    strip(new RegExp(dur[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }

  // ── recurrence (check before single-day words) ──
  if (/\b(every\s*day|daily)\b/i.test(text)) {
    recurrence = "daily";
    strip(/\b(every\s*day|daily)\b/i);
  } else if (/\b(every\s*weekday|weekdays)\b/i.test(text)) {
    recurrence = "weekdays";
    strip(/\b(every\s*weekday|weekdays?)\b/i);
  } else if (/\b(every\s*week|weekly)\b/i.test(text)) {
    recurrence = "weekly";
    strip(/\b(every\s*week|weekly)\b/i);
  }

  // ── due date ──
  if (recurrence == null) {
    const isoMatch = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    const inDays = text.match(/\bin\s+(\d+)\s+days?\b/i);
    if (isoMatch) {
      due = isoMatch[1];
      strip(/\b\d{4}-\d{2}-\d{2}\b/);
    } else if (/\b(today|tonight)\b/i.test(text)) {
      due = today;
      strip(/\b(today|tonight)\b/i);
    } else if (/\btomorrow\b/i.test(text)) {
      due = addDays(today, 1);
      strip(/\btomorrow\b/i);
    } else if (inDays) {
      due = addDays(today, Number(inDays[1]));
      strip(/\bin\s+\d+\s+days?\b/i);
    } else if (/\bnext\s+week\b/i.test(text)) {
      due = addDays(today, 7);
      strip(/\bnext\s+week\b/i);
    } else {
      const wd = text.match(
        /\b(?:on\s+|next\s+)?(sunday|sun|monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thu|friday|fri|saturday|sat)\b/i,
      );
      if (wd) {
        due = nextWeekday(today, WEEKDAYS[wd[1].toLowerCase()]);
        strip(new RegExp(wd[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
      }
    }
  }

  // ── tidy the leftover title ──
  let title = text
    .replace(/\b(on|by|at|every|due)\b\s*$/i, "") // dangling connectors
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\s,–-]+$/, "")
    .trim();

  return { title, due, estMin, recurrence };
}
