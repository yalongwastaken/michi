// celebrate.js — the game layer's fireworks department. Dependency-free confetti on
// a throwaway canvas, plus "what's newly worth celebrating" detection against a
// last-celebrated record (localStorage, with an in-memory fallback) so each feat
// fires exactly once (levels and badges forever, the daily goal once per day).
// Pure DOM — no React in here.
import { formatMeters } from "./format.js";

const KEY = "michi.celebrated";
// trail + iris + a pinch of amber
const COLORS = ["#10B981", "#34D399", "#8B5CF6", "#A78BFA", "#F59E0B"];

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
  const sameDay = prev?.day === momentum.day;
  writeRecord({
    day: momentum.day,
    goalMet: !!momentum.metGoal || (sameDay && !!prev.goalMet),
    level,
    milestones: earned,
  });
  if (!prev) {
    return null;
  }

  const events = [];
  if (momentum.xp && prev.level != null && level > prev.level) {
    events.push({
      headline: `Waypoint reached: ${momentum.xp.name}`,
      subline: `${formatMeters(momentum.xp.totalM)} walked so far.`,
    });
  }
  const fresh = earned.filter((d) => !(prev.milestones || []).includes(d));
  if (fresh.length) {
    events.push({
      headline: `${Math.max(...fresh)}-day streak!`,
      subline: "A badge for the collection — keep walking.",
    });
  }
  if (momentum.metGoal && !(sameDay && prev.goalMet)) {
    events.push({
      headline: "Daily goal met!",
      subline: `${momentum.todayCount} done today — the path continues tomorrow.`,
    });
  }
  return events[0] || null;
}
