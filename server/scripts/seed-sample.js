// seed-sample.js — build a rich, believable sample profile for testing michi.
//
// It generates a full-state snapshot (roadmaps → milestones → steps, projects,
// daily tasks, kata, and a ~16-day history of completions + kata honor days) all
// anchored to a base date, so the streak, heatmap, weekly review, XP, and
// discipline grade look alive the moment you load it.
//
// Usage:
//   node server/scripts/seed-sample.js                 → write samples/sample-profile.json
//   node server/scripts/seed-sample.js --date=2026-07-14   → anchor to a specific day
//   node --experimental-sqlite server/scripts/seed-sample.js --db   → RESET the DB and seed it
//
// The JSON it writes imports cleanly through Settings → Import (works on iPhone).
// `--db` replaces ALL existing data in the server's database.

import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", ".."); // repo root (server/scripts → repo)

// ── date helpers (UTC, YYYY-MM-DD — mirrors the app's day keys) ────────────────
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const has = (name) => process.argv.includes(`--${name}`);

const BASE = arg("date") || new Date().toISOString().slice(0, 10);
function shift(day, n) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const at = (day, h = 18) => `${day}T${String(h).padStart(2, "0")}:00:00.000Z`;
const today = BASE;

// ── the model ─────────────────────────────────────────────────────────────────
const roadmaps = [
  {
    id: "rm_embedded",
    title: "Bare-metal embedded",
    sourceUrl: null,
    color: "#4E8640",
    archived: false,
    position: 0,
    createdAt: at(shift(today, -40), 9),
    targetDate: shift(today, 90),
    stepMinutes: 30,
  },
  {
    id: "rm_rust",
    title: "Rust, in earnest",
    sourceUrl: null,
    color: "#B95530",
    archived: false,
    position: 1,
    createdAt: at(shift(today, -30), 9),
    targetDate: shift(today, 150),
    stepMinutes: 30,
  },
  {
    id: "rm_jp",
    title: "Japanese N5",
    sourceUrl: null,
    color: "#F59E0B",
    archived: false,
    position: 2,
    createdAt: at(shift(today, -25), 9),
    targetDate: shift(today, 60),
    stepMinutes: 20,
  },
  {
    id: "rm_old",
    title: "Web bootcamp",
    sourceUrl: null,
    color: "#64748B",
    archived: true,
    position: 3,
    createdAt: at(shift(today, -120), 9),
    targetDate: null,
    stepMinutes: 30,
  },
];

const milestones = [
  { id: "ms_e_fund", roadmapId: "rm_embedded", title: "Fundamentals", position: 0 },
  { id: "ms_e_periph", roadmapId: "rm_embedded", title: "Peripherals", position: 1 },
  { id: "ms_r_own", roadmapId: "rm_rust", title: "Ownership", position: 0 },
  { id: "ms_r_async", roadmapId: "rm_rust", title: "Async", position: 1 },
  { id: "ms_j_kana", roadmapId: "rm_jp", title: "Kana", position: 0 },
  { id: "ms_o_html", roadmapId: "rm_old", title: "HTML & CSS", position: 0 },
];

// step(id, milestone, title, status, {doneOffset, url, notes, position})
const steps = [
  // embedded · fundamentals
  {
    id: "st_gpio",
    milestoneId: "ms_e_fund",
    title: "Blink an LED (GPIO)",
    status: "done",
    position: 0,
    resourceUrl: "https://docs.rs-online.com/gpio",
    notes: "mind the pull-up on pin 4",
    doneAt: at(shift(today, -9)),
  },
  {
    id: "st_uart",
    milestoneId: "ms_e_fund",
    title: "UART hello world",
    status: "done",
    position: 1,
    resourceUrl: null,
    notes: null,
    doneAt: at(shift(today, -6)),
  },
  {
    id: "st_timers",
    milestoneId: "ms_e_fund",
    title: "Timers & interrupts",
    status: "doing",
    position: 2,
    resourceUrl: null,
    notes: "NVIC priorities still fuzzy",
    doneAt: null,
  },
  {
    id: "st_adc",
    milestoneId: "ms_e_fund",
    title: "ADC basics",
    status: "todo",
    position: 3,
    resourceUrl: null,
    notes: null,
    doneAt: null,
  },
  // embedded · peripherals
  {
    id: "st_spi",
    milestoneId: "ms_e_periph",
    title: "SPI driver",
    status: "todo",
    position: 0,
    resourceUrl: "https://www.analog.com/spi-intro",
    notes: null,
    doneAt: null,
  },
  {
    id: "st_i2c",
    milestoneId: "ms_e_periph",
    title: "I2C sensor read",
    status: "todo",
    position: 1,
    resourceUrl: null,
    notes: null,
    doneAt: null,
  },
  {
    id: "st_dma",
    milestoneId: "ms_e_periph",
    title: "DMA transfers",
    status: "todo",
    position: 2,
    resourceUrl: null,
    notes: null,
    doneAt: null,
  },
  // rust · ownership
  {
    id: "st_borrow",
    milestoneId: "ms_r_own",
    title: "Borrow-checker drills",
    status: "done",
    position: 0,
    resourceUrl: null,
    notes: null,
    doneAt: at(shift(today, -4)),
  },
  {
    id: "st_life",
    milestoneId: "ms_r_own",
    title: "Lifetimes in depth",
    status: "doing",
    position: 1,
    resourceUrl: "https://doc.rust-lang.org/nomicon/lifetimes.html",
    notes: null,
    doneAt: null,
  },
  {
    id: "st_smart",
    milestoneId: "ms_r_own",
    title: "Smart pointers (Box/Rc/RefCell)",
    status: "todo",
    position: 2,
    resourceUrl: null,
    notes: null,
    doneAt: null,
  },
  // rust · async
  {
    id: "st_fut",
    milestoneId: "ms_r_async",
    title: "Futures & pinning",
    status: "todo",
    position: 0,
    resourceUrl: null,
    notes: null,
    doneAt: null,
  },
  {
    id: "st_tokio",
    milestoneId: "ms_r_async",
    title: "Tokio basics",
    status: "todo",
    position: 1,
    resourceUrl: null,
    notes: null,
    doneAt: null,
  },
  // japanese · kana
  {
    id: "st_hira",
    milestoneId: "ms_j_kana",
    title: "Hiragana",
    status: "done",
    position: 0,
    resourceUrl: null,
    notes: null,
    doneAt: at(shift(today, -12)),
  },
  {
    id: "st_kata",
    milestoneId: "ms_j_kana",
    title: "Katakana",
    status: "doing",
    position: 1,
    resourceUrl: null,
    notes: null,
    doneAt: null,
  },
  // archived roadmap keeps a finished step (its tree is omitted from the export)
  {
    id: "st_html",
    milestoneId: "ms_o_html",
    title: "Semantic HTML",
    status: "done",
    position: 0,
    resourceUrl: null,
    notes: null,
    doneAt: at(shift(today, -110)),
  },
];

const projects = [
  {
    id: "pj_blinky",
    title: "Blinky firmware",
    status: "active",
    repoUrl: "https://github.com/sam/blinky",
    summary: "A tiny RP2040 firmware to drive an RGB LED — my embedded playground.",
    position: 0,
    createdAt: at(shift(today, -20), 9),
    shippedAt: null,
    roadmapId: "rm_embedded",
  },
  {
    id: "pj_site",
    title: "Portfolio site",
    status: "shipped",
    repoUrl: "https://github.com/sam/portfolio",
    summary: "A small static site for projects and notes.",
    position: 0,
    createdAt: at(shift(today, -60), 9),
    shippedAt: at(shift(today, -18)),
    roadmapId: null,
  },
  {
    id: "pj_cli",
    title: "CLI todo in Rust",
    status: "idea",
    repoUrl: null,
    summary: "An excuse to practice ownership: a fast terminal task list.",
    position: 0,
    createdAt: at(shift(today, -8), 9),
    shippedAt: null,
    roadmapId: "rm_rust",
  },
];

// task(id, title, status, {due, estMin, stepId, projectId, recurrence, notes, doneOffset})
const T = (id, title, status, o = {}) => ({
  id,
  title,
  status,
  due: o.due ?? null,
  recurrence: o.recurrence ?? null,
  stepId: o.stepId ?? null,
  projectId: o.projectId ?? null,
  estMin: o.estMin ?? null,
  position: o.position ?? 0,
  notes: o.notes ?? null,
  createdAt: at(shift(today, -(o.age ?? 3)), 9),
  doneAt: o.doneOffset != null ? at(shift(today, -o.doneOffset)) : null,
});

const tasks = [
  T("tk_spi", "Read the SPI datasheet §3", "todo", {
    due: today,
    estMin: 30,
    stepId: "st_spi",
    position: 0,
    notes: "left off at §2.4 — clock polarity",
  }),
  T("tk_life", "Rust: work through the lifetimes chapter", "todo", {
    due: today,
    estMin: 25,
    stepId: "st_life",
    position: 1,
  }),
  T("tk_board", "Order the dev board + jumper wires", "todo", {
    due: today,
    estMin: 10,
    position: 2,
  }),
  T("tk_email", "Email advisor about the capstone scope", "todo", {
    due: shift(today, -1),
    estMin: 15,
    position: 3,
    age: 5,
  }),
  T("tk_blog", "Draft blog post: GPIO gotchas", "todo", {
    due: shift(today, 2),
    estMin: 45,
    projectId: "pj_site",
    position: 4,
  }),
  T("tk_katakana", "Review the katakana deck", "todo", {
    recurrence: "daily",
    estMin: 10,
    stepId: "st_kata",
    position: 5,
    age: 20,
  }),
  T("tk_standup", "Write standup notes", "todo", {
    recurrence: "weekdays",
    estMin: 5,
    position: 6,
    age: 20,
  }),
  // finished today — feeds today's count + the "done today" list
  T("tk_readpin", "Skim the RP2040 datasheet intro", "done", {
    estMin: 20,
    stepId: "st_spi",
    position: 7,
    doneOffset: 0,
  }),
  T("tk_refactor", "Refactor the LED blink loop", "done", {
    estMin: 20,
    projectId: "pj_blinky",
    position: 8,
    doneOffset: 0,
  }),
];

const KATA = ["ka_grey", "ka_feeds", "ka_shutdown", "ka_pages"];
const kata = [
  {
    id: "ka_grey",
    title: "Greyscale phone",
    note: "colour back on weekends",
    builtinId: "greyscale-phone",
    active: true,
    position: 0,
    createdAt: at(shift(today, -20), 9),
  },
  {
    id: "ka_feeds",
    title: "No feeds before noon",
    note: null,
    builtinId: null,
    active: true,
    position: 1,
    createdAt: at(shift(today, -20), 9),
  },
  {
    id: "ka_shutdown",
    title: "Evening shutdown ritual",
    note: "close the laptop by 22:00",
    builtinId: null,
    active: true,
    position: 2,
    createdAt: at(shift(today, -16), 9),
  },
  {
    id: "ka_pages",
    title: "Morning pages",
    note: null,
    builtinId: null,
    active: true,
    position: 3,
    createdAt: at(shift(today, -16), 9),
  },
];

// ── history: completions (drives streak / heatmap / XP / weekly review) ─────────
// A believable ~2-week rhythm ending today — a real completion every day so the
// current streak and the longest streak agree (no freeze-bridged gaps that would
// make "current" exceed "longest"). Real ids so the weekly review resolves titles.
const dayWork = {
  0: [
    ["task", "tk_readpin"],
    ["task", "tk_refactor"],
    ["task", "tk_katakana"],
  ],
  1: [
    ["task", "tk_standup"],
    ["task", "tk_katakana"],
    ["step", "st_timers"],
  ],
  2: [
    ["task", "tk_katakana"],
    ["task", "tk_standup"],
  ],
  3: [
    ["task", "tk_standup"],
    ["task", "tk_katakana"],
    ["task", "tk_email"],
  ],
  4: [
    ["step", "st_borrow"],
    ["task", "tk_katakana"],
    ["task", "tk_standup"],
  ],
  5: [
    ["task", "tk_katakana"],
    ["task", "tk_standup"],
  ],
  6: [
    ["step", "st_uart"],
    ["task", "tk_katakana"],
  ],
  7: [
    ["task", "tk_standup"],
    ["task", "tk_katakana"],
  ],
  8: [
    ["task", "tk_katakana"],
    ["task", "tk_standup"],
  ],
  9: [
    ["step", "st_gpio"],
    ["task", "tk_katakana"],
  ],
  10: [
    ["task", "tk_standup"],
    ["task", "tk_katakana"],
  ],
  11: [["task", "tk_katakana"]],
  12: [
    ["task", "tk_katakana"],
    ["task", "tk_standup"],
  ],
  13: [["task", "tk_katakana"]],
  14: [
    ["task", "tk_katakana"],
    ["task", "tk_standup"],
  ],
  15: [
    ["step", "st_hira"],
    ["task", "tk_katakana"],
  ],
};

let cid = 0;
const completions = [];
for (const [offset, items] of Object.entries(dayWork)) {
  const day = shift(today, -Number(offset));
  for (const [kind, refId] of items) {
    completions.push({ id: `cmp_${++cid}`, day, kind, refId, ts: at(day) });
  }
}

// kata honor ledger: mostly clean days (grade + clean streak), today left partial
// so there's something to tap during testing, a couple of partial days for texture.
const partialDays = new Set([0, 7, 13]);
const kataDays = [];
for (let offset = 0; offset <= 15; offset++) {
  const day = shift(today, -offset);
  const activeIds = offset >= 4 ? ["ka_grey", "ka_feeds"] : KATA; // shutdown+pages added ~day 16 ago
  const honoredIds = partialDays.has(offset) ? activeIds.slice(0, 1) : activeIds;
  // every day the honor engine touched gets a row, so add kata completions to the
  // heatmap for each honored form (kata count toward the heatmap + XP)
  for (const id of honoredIds) {
    const day2 = day;
    completions.push({ id: `cmp_${++cid}`, day: day2, kind: "kata", refId: id, ts: at(day2, 8) });
  }
  kataDays.push({ day, activeIds, honoredIds });
}

const state = {
  profile: {
    name: "Sam",
    focusAreas: ["Embedded", "Rust"],
    onboarded: true,
    mascot: "kitsune",
  },
  settings: {
    theme: "system",
    intensity: "steady",
    dailyGoal: 3,
    weeklyGoal: 15,
    weeklyActiveDays: 5,
    streakFreezes: 2,
    dailyMinutes: 60,
    defaultStepMin: 30,
    taskDefaultMin: 20,
  },
  roadmaps,
  milestones,
  steps,
  projects,
  tasks,
  kata,
  completions,
  kataDays,
};

// ── output ──────────────────────────────────────────────────────────────────
const json = JSON.stringify(state, null, 2);

if (has("db")) {
  const db = await import("../db.js");
  const bad = db.validateState(state);
  if (bad) {
    console.error("refusing to seed — invalid state:", bad);
    process.exit(1);
  }
  db.resetAll();
  db.importAll(state);
  console.log(
    `Seeded the database (${process.env.MICHI_DB || "server/data/michi.db"}) — anchored to ${today}.`,
  );
} else {
  const outDir = join(ROOT, "samples");
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, "sample-profile.json");
  writeFileSync(out, json + "\n");
  console.log(`Wrote ${out} (anchored to ${today}).`);
}
