// celebrate.js — the game layer's fireworks department. Dependency-free confetti on
// a throwaway canvas, plus "what's newly worth celebrating" detection against a
// last-celebrated record (localStorage, with an in-memory fallback) so each feat
// fires exactly once (levels and badges forever, the daily goal once per day).
// Pure DOM — no React in here.
import { formatMeters } from "./format.js";

const KEY = "michi.celebrated";
// trail persimmon + iris indigo + a pinch of amber
const COLORS = ["#F25C05", "#F47C36", "#5B67B7", "#A9B1DC", "#F59E0B"];

/** A 1.2s confetti burst overlay. No-op under prefers-reduced-motion (checked at
 * call time, so a live setting change is respected). Removes itself when done. */
export function confettiBurst() {
  if (typeof document === "undefined") {
    return;
  }
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
    return;
  }
  const canvas = document.createElement("canvas");
  const dpr = window.devicePixelRatio || 1;
  const W = window.innerWidth;
  const H = window.innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.cssText =
    "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:70";
  canvas.setAttribute("aria-hidden", "true");
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  const parts = Array.from({ length: 80 }, () => {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.7; // upward fan
    const speed = 6 + Math.random() * 9;
    return {
      x: W / 2 + (Math.random() - 0.5) * W * 0.35,
      y: H * 0.4,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      w: 5 + Math.random() * 5,
      h: 3 + Math.random() * 4,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      color: COLORS[(Math.random() * COLORS.length) | 0],
    };
  });

  const DURATION = 1200;
  const t0 = performance.now();
  const tick = (t) => {
    const el = t - t0;
    ctx.clearRect(0, 0, W, H);
    const fade = Math.max(0, 1 - Math.max(0, el - DURATION * 0.6) / (DURATION * 0.4));
    for (const p of parts) {
      p.vy += 0.32; // gravity
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (el < DURATION) {
      requestAnimationFrame(tick);
    } else {
      canvas.remove();
    }
  };
  requestAnimationFrame(tick);
}

// in-memory overlay for the record: writes always land here even when localStorage
// throws (storage full, private mode), so a broken store can't refire the same
// confetti on every refresh — or, if reads break too, mute celebrations entirely
let memoryRecord = null;

function readRecord() {
  let stored = null;
  try {
    const r = JSON.parse(localStorage.getItem(KEY));
    stored = r && typeof r === "object" ? r : null;
  } catch {
    /* unreadable store — the in-memory copy still carries this session */
  }
  // the memory copy is at least as fresh as the store (every write updates it),
  // so it wins; stored only matters on a fresh page load
  return memoryRecord || stored;
}

function writeRecord(rec) {
  memoryRecord = rec; // always lands, even when the store below throws
  try {
    localStorage.setItem(KEY, JSON.stringify(rec));
  } catch {
    /* storage full / private mode — memory keeps this session honest,
       persistence resumes whenever the store recovers */
  }
}

/**
 * Compare fresh momentum against the last-celebrated record; returns at most one
 * {headline, subline} event (priority: waypoint > streak badge > daily goal) and
 * records everything seen, so runners-up never fire late. The very first look
 * seeds the record silently — no fireworks for history.
 */
export function checkCelebrations(momentum) {
  if (!momentum) {
    return null;
  }
  const earned = (momentum.milestones || []).filter((b) => b.earned).map((b) => b.days);
  const level = momentum.xp?.level ?? 0;
  const prev = readRecord();
  // first look is gated on OUR fields: checkRituals may have looked first and
  // seeded a rituals-only record, and that must still count as a first look here —
  // otherwise every historical badge (and today's met goal) would refire
  const firstLook = prev == null || prev.day == null;
  const sameDay = prev?.day === momentum.day;
  writeRecord({
    day: momentum.day,
    goalMet: !!momentum.metGoal || (sameDay && !!prev.goalMet),
    level,
    milestones: earned,
    // the daruma ledgers belong to checkRituals — carry them through untouched
    ...(prev?.rituals ? { rituals: prev.rituals } : {}),
    ...(prev?.ritualSeen ? { ritualSeen: prev.ritualSeen } : {}),
  });
  if (firstLook) {
    return null;
  }

  const events = [];
  if (momentum.xp && prev.level != null && level > prev.level) {
    events.push({
      headline: `Waypoint reached: ${momentum.xp.name}`,
      subline: `${formatMeters(momentum.xp.totalM)} walked so far.`,
      mood: "waypoint", // the toast mascot gets the gold aura, not the usual cheer
    });
  }
  const fresh = earned.filter((d) => !(prev.milestones || []).includes(d));
  if (fresh.length) {
    events.push({
      headline: `${Math.max(...fresh)}-day streak!`,
      subline: "A badge for the collection — keep walking.",
      mood: "celebrate",
    });
  }
  if (momentum.metGoal && !(sameDay && prev.goalMet)) {
    events.push({
      headline: "Daily goal met!",
      subline: `${momentum.todayCount} done today — the path continues tomorrow.`,
      mood: "celebrate",
    });
  }
  return events[0] || null;
}

/**
 * The daruma ritual: a dated roadmap crossing to 100% earns its second eye, once
 * ever. Takes the roadmap tree (id/title/targetDate/complete — `complete` is the
 * exact done===total flag, never pct rounding) and fires only on an OBSERVED
 * transition: every dated roadmap is ledgered on sight (`ritualSeen` while still
 * in progress, `rituals` once complete), and the eye opens only for a roadmap this
 * record previously saw below 100%. One that arrives already finished — an import,
 * the feature's first run — goes straight onto the once-ever ledger, silently.
 * Returns at most one event.
 */
export function checkRituals(roadmaps) {
  const dated = (roadmaps || []).filter((r) => r.targetDate);
  const prev = readRecord();
  const fired = prev?.rituals || []; // complete on an earlier look — never fires (again)
  const seen = prev?.ritualSeen || []; // observed in progress at some point
  const fresh = dated.find((r) => r.complete && seen.includes(r.id) && !fired.includes(r.id));
  writeRecord({
    ...(prev || {}),
    rituals: [...new Set([...fired, ...dated.filter((r) => r.complete).map((r) => r.id)])],
    ritualSeen: [...new Set([...seen, ...dated.filter((r) => !r.complete).map((r) => r.id)])],
  });
  if (!fresh) {
    return null;
  }
  return {
    headline: `Both eyes open — ${fresh.title} walked.`,
    mood: "celebrate",
    species: "daruma", // the goal object itself celebrates, whoever the companion is
    eyesFilled: true,
    burst: 1,
  };
}
