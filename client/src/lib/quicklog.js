// quicklog.js — turn a spoken-style log line into a timed journal entry, so logging
// what you did is one field, not a form. Examples it understands:
//   "studied SPI 9-11"            → 09:00–11:00, "studied SPI"
//   "Blinky firmware 2pm-3:30"    → 14:00–15:30, "Blinky firmware"
//   "read datasheet 90m"          → 90 min (untimed), "read datasheet"
//   "standup 9:30am for 15m"      → 09:30 + 15 min → 09:30–09:45
//   "planning 14:00-15:00"        → 14:00–15:00
// Deliberately conservative: a bare number ("read chapter 3") is NOT a time, so it
// never eats real words. Pure + dependency-free → easy to unit-test.

// a clock token: 9, 9:30, 9am, 2:15pm — capture hour, minute, meridiem
const CLOCK = "(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm|a|p)?";
const RANGE = new RegExp(`\\b${CLOCK}\\s*(?:-|–|—|to)\\s*${CLOCK}\\b`, "i");
// a single EXPLICIT time — must carry am/pm or a colon so "3" alone isn't a time
const SINGLE = new RegExp(
  `\\b(\\d{1,2}):(\\d{2})\\s*(am|pm|a|p)?\\b|\\b(\\d{1,2})\\s*(am|pm|a|p)\\b`,
  "i",
);
// durations: "2h", "1.5h", "90m", "1h30", "1h30m". Two alternatives so it can never
// match the empty string (both groups being optional would match at position 0):
//   1=hours (+ 2=trailing minutes), or 3=minutes-only
const DUR =
  /\b(\d+(?:\.\d+)?)\s*h(?:rs?|ours?)?(?:\s*(\d{1,3})\s*m?)?\b|\b(\d{1,3})\s*m(?:in(?:s|utes?)?)?\b/i;

const clamp = (n) => Math.max(0, Math.min(1439, Math.round(n)));

// hour + minute + meridiem → minutes from midnight (null if hour is out of range)
function toMin(hRaw, mRaw, ap) {
  let h = Number(hRaw);
  const m = Number(mRaw || 0);
  if (!Number.isFinite(h) || h > 24 || m > 59) {
    return null;
  }
  const mer = ap ? ap[0].toLowerCase() : null; // "a" | "p" | null
  if (mer === "p" && h < 12) {
    h += 12;
  } else if (mer === "a" && h === 12) {
    h = 0;
  }
  if (h >= 24) {
    h -= 24;
  }
  return clamp(h * 60 + m);
}

function parseDuration(s) {
  const m = s.match(DUR);
  if (!m) {
    return null;
  }
  const mins = m[1]
    ? parseFloat(m[1]) * 60 + (m[2] ? parseInt(m[2], 10) : 0)
    : m[3]
      ? parseInt(m[3], 10)
      : 0;
  return mins > 0 ? { minutes: Math.round(mins), match: m[0] } : null;
}

const tidy = (s) =>
  s
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,\-–—:]+|[\s,\-–—:]+$/g, "")
    .replace(/\b(from|at|for)\s*$/i, "")
    .replace(/\s+\b(from|at|for)\b\s*$/i, "")
    .trim();

/**
 * Parse a log line.
 * @returns {{title:string, startMin:number|null, endMin:number|null, minutes:number|null}}
 */
export function parseQuickLog(input) {
  let text = String(input || "").trim();
  let startMin = null;
  let endMin = null;
  let minutes = null;

  const range = text.match(RANGE);
  if (range) {
    let s = toMin(range[1], range[2], range[3]);
    let e = toMin(range[4], range[5], range[6]);
    // meridiem carry: "2-3:30pm" → both pm; "9-11" (neither) stays literal
    if (s != null && e != null) {
      const startHadMer = !!range[3];
      const endHadMer = !!range[6];
      if (!startHadMer && endHadMer && s > e) {
        s = s >= 720 ? s - 720 : s; // pull start into the same half-day as the end
        if (s > e) {
          e += 720; // …or push the end past noon (e.g. "11-1pm")
        }
      }
      if (e < s) {
        e += 720; // last-ditch: assume the end is pm ("11-1" → 11:00–13:00)
      }
      startMin = s;
      endMin = clamp(e);
      minutes = endMin - startMin;
    }
    text = tidy(text.replace(range[0], " "));
    return { title: text, startMin, endMin, minutes };
  }

  const single = text.match(SINGLE);
  if (single) {
    // two alternations: [1..3] = HH:MM(ap)?, [4..5] = H(ap)
    startMin =
      single[1] != null ? toMin(single[1], single[2], single[3]) : toMin(single[4], 0, single[5]);
    text = tidy(text.replace(single[0], " "));
  }

  const dur = parseDuration(text);
  if (dur) {
    minutes = dur.minutes;
    text = tidy(text.replace(dur.match, " "));
    if (startMin != null) {
      endMin = clamp(startMin + minutes);
    }
  }

  return { title: text, startMin, endMin, minutes };
}

/** minutes-from-midnight → "9:30 AM" for display. */
export function minLabel(min) {
  if (min == null) {
    return "";
  }
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  const ap = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ap}`;
}

/** a compact duration like "1h 30m" / "45m". */
export function durLabel(min) {
  if (!min || min <= 0) {
    return "";
  }
  const h = Math.floor(min / 60);
  const m = min % 60;
  return [h ? `${h}h` : "", m ? `${m}m` : ""].filter(Boolean).join(" ");
}
