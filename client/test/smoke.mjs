// smoke.mjs — headless render smoke test. Mounts <App/> in jsdom against a stubbed
// server, walks every tab, opens Settings, and exercises quick-add. Catches the
// "undefined variable / bad hook → blank screen" class of bug that a build does NOT
// (building ≠ rendering).  Run: cd client && npm run test:smoke
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
process.on("unhandledRejection", (e) => {
  console.error("unhandledRejection:", e);
  process.exit(1);
});

// 1) transpile/bundle the app (node_modules stay external, resolved at runtime)
await build({
  entryPoints: [join(here, "../src/App.jsx")],
  outdir: join(here, ".tmp"),
  bundle: true,
  format: "esm",
  splitting: true,
  packages: "external",
  jsx: "automatic",
  define: { "import.meta.env": JSON.stringify({ PROD: false, DEV: true }) },
  logLevel: "silent",
});

// 2) jsdom globals
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});
for (const k of ["window", "document", "HTMLElement", "Element", "Node", "getComputedStyle"]) {
  globalThis[k] = dom.window[k];
}
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// 3) stubbed server
const STATE = {
  rev: 1,
  roadmaps: [
    {
      id: "R",
      title: "Embedded",
      color: "#10B981",
      archived: false,
      position: 0,
      createdAt: "2026-05-01T00:00:00Z",
      targetDate: "2026-07-01",
      stepMinutes: 30,
    },
  ],
  milestones: [{ id: "m", roadmapId: "R", title: "Basics", position: 0 }],
  steps: [
    {
      id: "s1",
      milestoneId: "m",
      title: "GPIO",
      status: "done",
      position: 0,
      doneAt: "2026-06-23T10:00:00Z",
    },
    { id: "s2", milestoneId: "m", title: "UART", status: "doing", position: 1 },
    { id: "s3", milestoneId: "m", title: "SPI", status: "todo", position: 2 },
  ],
  projects: [
    { id: "p", title: "Blinky", status: "active", position: 0, createdAt: "2026-06-01T00:00:00Z" },
  ],
  tasks: [
    {
      id: "t1",
      title: "Read datasheet",
      status: "todo",
      due: "2026-06-23",
      estMin: 20,
      notes: "start at §4.2 — the pinout table",
    },
  ],
  completions: [
    { id: "c1", day: "2026-06-23", kind: "step", refId: "s1", ts: "2026-06-23T10:00:00Z" },
  ],
  kata: [
    {
      id: "k1",
      title: "greyscale phone",
      note: null,
      builtinId: "greyscale-phone",
      active: true,
      position: 0,
      createdAt: "2026-06-01T00:00:00Z",
    },
    {
      id: "k2",
      title: "morning pages",
      note: "three pages, longhand",
      builtinId: null,
      active: true,
      position: 1,
      createdAt: "2026-06-02T00:00:00Z",
    },
    {
      id: "k3",
      title: "phone in another room",
      note: null,
      builtinId: "phone-away",
      active: false,
      position: 2,
      createdAt: "2026-06-03T00:00:00Z",
    },
  ],
  profile: { name: "Sam", onboarded: true, focusAreas: [], mascot: "shiba" },
  settings: {
    theme: "light",
    dailyGoal: 3,
    streakFreezes: 2,
    dailyMinutes: 60,
    defaultStepMin: 30,
    taskDefaultMin: 20,
  },
};
const PLAN = {
  day: "2026-06-23",
  budgetMin: 60,
  plannedMin: 50,
  overflow: false,
  counts: { due: 1, pace: 1, continue: 0, rotate: 0 },
  why: "1 due item + 1 step — ~50 of 60 min.",
  items: [
    {
      kind: "task",
      id: "t1",
      title: "Read datasheet",
      status: "todo",
      due: "2026-06-23",
      reason: "due",
      estMin: 20,
    },
    {
      kind: "step",
      id: "s2",
      title: "UART",
      status: "doing",
      roadmapTitle: "Embedded",
      milestoneTitle: "Basics",
      reason: "pace",
      estMin: 30,
    },
  ],
};
const DASH = {
  today: {
    day: "2026-06-23",
    overdue: [],
    dueToday: [
      { kind: "task", id: "t1", title: "Read datasheet", status: "todo", due: "2026-06-23" },
    ],
    suggested: [
      {
        kind: "step",
        id: "s2",
        title: "UART",
        status: "doing",
        roadmapTitle: "Embedded",
        milestoneTitle: "Basics",
      },
    ],
    doneToday: [],
    focus: [],
    counts: { overdue: 0, dueToday: 1, suggested: 1, doneToday: 0 },
  },
  momentum: {
    day: "2026-06-23",
    streak: { current: 1, longest: 1, atRisk: false, freezesUsed: 0, freezes: 3 },
    freezes: { base: 2, earned: 1, total: 3, used: 0, left: 3 },
    todayCount: 1,
    dailyGoal: 3,
    metGoal: false,
    daysActive: 1,
    totalDone: 1,
    roadmaps: [
      { id: "R", title: "Embedded", color: "#10B981", archived: false, done: 1, total: 3, pct: 33 },
    ],
    projects: { idea: 0, active: 1, shipped: 0 },
    heat: [{ date: "2026-06-23", count: 1 }],
    discipline: {
      cleanDays: 12,
      cleanStreak: 3,
      grade: {
        n: 7,
        label: "7級",
        romaji: "7th kyū",
        english: "seventh grade",
        cleanDays: 12,
        next: { label: "6級", at: 15, toGo: 3 },
        pct: 40,
      },
      week: [
        { day: "2026-06-17", state: "none" },
        { day: "2026-06-18", state: "partial" },
        { day: "2026-06-19", state: "clean" },
        { day: "2026-06-20", state: "clean" },
        { day: "2026-06-21", state: "clean" },
        { day: "2026-06-22", state: "clean" },
        { day: "2026-06-23", state: "pending" },
      ],
    },
  },
  plan: PLAN,
  insights: [{ kind: "deadline", tone: "warn", text: "Embedded: 8 days left, ~1/day to finish." }],
  kata: {
    items: [
      {
        id: "k1",
        title: "greyscale phone",
        builtinId: "greyscale-phone",
        active: true,
        honoredToday: true,
      },
      { id: "k2", title: "morning pages", builtinId: null, active: true, honoredToday: false },
    ],
    today: { honored: 1, total: 2, clean: false },
  },
  kataSuggestions: [
    {
      builtinId: "shutdown",
      title: "shutdown ritual",
      reason: "4 completions after 21:00 this week — close the day on purpose",
    },
  ],
};

// what a delete PUT reports as trashed — two rows, so the toast's plural path
// ("Deleted 2 items") and the restore-them-all undo get exercised
const TRASHED = [
  { id: "tr_a", kind: "step", title: "SPI" },
  { id: "tr_b", kind: "task", title: "Read datasheet" },
];

// honoring the last form: the server reports the day clean — in the honor
// response's kataToday AND every dashboard after it (the real server is
// consistent, and App's clean-day toast now only fires from server truth:
// the reconciled block, never the optimistic chip flip)
const CLEAN_KATA = {
  items: DASH.kata.items.map((it) => ({ ...it, honoredToday: true })),
  today: { honored: 2, total: 2, clean: true },
};
let honored = false; // flips once /api/kata/honor lands

let lastPost = null;
const posts = []; // every mutating request, for multi-call assertions
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (opts.method === "POST" || opts.method === "PUT") {
    lastPost = u;
    posts.push(u);
  }
  let body = STATE;
  if (u.includes("/api/config")) {
    body = { ai: false, model: null };
  } else if (u.includes("/api/kata/honor")) {
    honored = true;
    body = { ...STATE, kataToday: CLEAN_KATA };
  } else if (u.includes("/api/state") && opts.method === "PUT") {
    body = { ...STATE, trashed: TRASHED }; // the PUT's trash receipt
  } else if (u.includes("/api/trash/restore")) {
    body = { state: STATE, restored: { id: "tr_a", kind: "step", title: "SPI", remapped: false } };
  } else if (u.includes("/api/trash")) {
    body = {
      items: [
        {
          id: "trash_1",
          kind: "task",
          title: "Old scratch task",
          deletedAt: "2026-06-20T09:00:00Z",
          counts: null,
        },
        {
          id: "trash_2",
          kind: "step",
          title: "Old scratch step",
          deletedAt: "2026-06-21T09:00:00Z",
          counts: null,
        },
      ],
    };
  } else if (u.includes("/api/dashboard")) {
    body = honored ? { ...DASH, kata: CLEAN_KATA } : DASH;
  } else if (u.includes("/api/plan")) {
    body = PLAN;
  } else if (u.includes("/api/momentum")) {
    body = DASH.momentum;
  } else if (u.includes("/api/today")) {
    body = DASH.today;
  } else if (u.includes("/api/journal")) {
    body = { entries: [] };
  }
  return { ok: true, status: 200, json: async () => body, text: async () => "" };
};

const errors = [];
dom.window.addEventListener("error", (e) => errors.push(e.error?.message || e.message));

// 4) mount + walk
const React = (await import("react")).default;
const { createRoot } = await import("react-dom/client");
const { act } = await import("react");
const { default: App } = await import(join(here, ".tmp/App.js"));

const root = createRoot(document.getElementById("root"));
const fails = [];
await act(async () => {
  root.render(React.createElement(App, { onTheme: () => {} }));
});
await new Promise((r) => setTimeout(r, 250));

// nav now has four tabs — Home | Today | Plan | Progression. Roadmaps and Projects
// were folded into the Plan tab as a segmented sub-view (aria-label "Plan view"),
// so navigating to either first opens Plan, then clicks its sub-toggle in <main>.
const clickIn = async (root, pred) => {
  const b = [...(root?.querySelectorAll("button") || [])].find(pred);
  if (!b) {
    return false;
  }
  await act(async () => b.click());
  await new Promise((r) => setTimeout(r, 120));
  return true;
};
const navTo = async (label) => {
  const nav = document.querySelector("nav");
  if (label === "Roadmaps" || label === "Projects") {
    if (!(await clickIn(nav, (x) => x.textContent.includes("Plan")))) {
      return false;
    }
    const seg = document.querySelector('[aria-label="Plan view"]');
    return clickIn(seg, (x) => x.textContent.trim() === label);
  }
  return clickIn(nav, (x) => x.textContent.includes(label));
};

for (const name of ["Home", "Today", "Plan", "Focus", "Journal", "Progress"]) {
  try {
    if (!(await navTo(name))) {
      fails.push(`${name}: no nav button`);
      continue;
    }
    const len = document.querySelector("main")?.innerHTML.length || 0;
    if (len < 50) {
      fails.push(`${name}: blank`);
    } else {
      console.log(`  ✓ ${name}`);
    }
  } catch (e) {
    fails.push(`${name}: ${e.message}`);
  }
}

// the discipline card on Progress: grade glyph + romaji title, the clean-day
// caption, and seven week dots each carrying an accessible "{day}: {state}"
try {
  await navTo("Progress");
  const main = document.querySelector("main");
  const txt = main?.textContent || "";
  if (!txt.includes("7級") || !txt.includes("7th kyū")) {
    fails.push("discipline: grade title (label · romaji) missing");
  } else if (!txt.includes("12 clean days") || !txt.includes("3 to 6級")) {
    fails.push("discipline: clean-day caption missing");
  } else if (
    // role="img" on the dots (a bare span's aria-label is ignored by most screen
    // readers) inside the labelled group — the a11y contract for the week strip
    !main.querySelector(
      '[role="group"][aria-label="last 7 days of kata"] [role="img"][aria-label="2026-06-23: pending"]',
    ) ||
    !main.querySelector('[role="img"][aria-label="2026-06-19: clean"]') ||
    !main.querySelector('[role="img"][aria-label="2026-06-18: partial"]') ||
    !main.querySelector('[role="img"][aria-label="2026-06-17: none"]')
  ) {
    fails.push("discipline: week dots missing their group/img roles or day/state labels");
  } else {
    console.log("  ✓ discipline card: grade, caption, labelled week dots");
  }
  await navTo("Today");
} catch (e) {
  fails.push(`discipline: ${e.message}`);
}

// Settings modal — and its trash section must render every kind sanely,
// including the step rows the per-step delete now leaves behind
try {
  const gear = document.querySelector('button[aria-label="Settings"]');
  await act(async () => gear.click());
  await new Promise((r) => setTimeout(r, 100));
  const dlg = document.querySelector('[role="dialog"]');
  if (!dlg) {
    fails.push("Settings: dialog didn't open");
  } else if (
    !dlg.textContent.includes("Old scratch task") ||
    !dlg.textContent.includes("Old scratch step")
  ) {
    fails.push("Settings: trash rows missing (a step row must display too)");
  } else {
    console.log("  ✓ Settings dialog (trash lists task + step rows)");
    // the companion picker: nine labelled species buttons, the current one checked
    const picker = dlg.querySelector('[role="radiogroup"][aria-label="Companion"]');
    const choices = [...(picker?.querySelectorAll('button[role="radio"]') || [])];
    if (choices.length !== 9) {
      fails.push(`Settings: companion picker has ${choices.length} choices, expected 9`);
    } else if (!choices.some((b) => b.getAttribute("aria-checked") === "true")) {
      fails.push("Settings: no companion is marked as the current one");
    } else {
      console.log("  ✓ Settings companion picker (9 species, current one checked)");
    }
    const close = dlg.querySelector('button[aria-label="Close"]');
    await act(async () => close?.click());
  }
} catch (e) {
  fails.push(`Settings: ${e.message}`);
}

// quick-add interaction (back on Today)
try {
  await navTo("Today");
  const input = document.querySelector('input[aria-label="New task"]');
  const setValue = (el, v) => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(el, v);
    el.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  };
  await act(async () => setValue(input, "read SPI 30m tomorrow"));
  const addBtn = document.querySelector('button[aria-label="Add task"]');
  lastPost = null;
  await act(async () => addBtn.click());
  await new Promise((r) => setTimeout(r, 120));
  if (!lastPost || !lastPost.includes("/api/tasks")) {
    fails.push("quick-add: did not POST a task");
  } else {
    console.log("  ✓ quick-add posts a task");
  }
} catch (e) {
  fails.push(`quick-add: ${e.message}`);
}

// the 型 strip: labelled honor chips, a tap POSTs /api/kata/honor, and honoring
// the LAST form raises the quiet clean-day toast (locked mood, no confetti)
try {
  const honoredChip = document.querySelector(
    'button[aria-label="kata: greyscale phone — honored today"]',
  );
  const waiting = document.querySelector(
    'button[aria-label="kata: morning pages — not honored yet"]',
  );
  if (!honoredChip || !waiting) {
    fails.push("kata strip: honor chips missing or unlabelled");
  } else {
    lastPost = null;
    await act(async () => waiting.click());
    await new Promise((r) => setTimeout(r, 150));
    if (!lastPost || !lastPost.includes("/api/kata/honor")) {
      fails.push("kata strip: honoring didn't POST /api/kata/honor");
    } else {
      const toast = [...document.querySelectorAll('[role="status"] button')].find((el) =>
        el.textContent.includes("clean day — 型 held."),
      );
      if (!toast) {
        fails.push("kata strip: honoring the last form didn't raise the clean-day toast");
      } else if (!toast.querySelector('span[lang="ja"]')) {
        fails.push("kata strip: the toast's kanji run isn't wrapped in lang=\"ja\"");
      } else {
        await act(async () => toast.click()); // dismiss — the walk continues
        console.log("  ✓ kata strip: labelled chips, honor POST, clean-day toast (lang=ja kanji)");
      }
    }
  }
} catch (e) {
  fails.push(`kata strip: ${e.message}`);
}

// the dōjō sheet: suggestion (with its reason) adopts, an active form retires,
// and a custom form adds — each through a full-state PUT
try {
  const door = document.querySelector('button[aria-label="open the dōjō — the training hall"]');
  if (!door) {
    fails.push("dōjō: no 道場 button on the kata strip");
  } else {
    await act(async () => door.click());
    await new Promise((r) => setTimeout(r, 100));
    const dlg = document.querySelector(
      '[role="dialog"][aria-label="道場 dōjō — the training hall"]',
    );
    if (!dlg) {
      fails.push("dōjō: sheet didn't open");
    } else {
      if (!dlg.querySelector('h2 span[lang="ja"]')) {
        fails.push('dōjō: the sheet title\'s 道場 glyphs lack lang="ja"');
      }
      if (
        !dlg.textContent.includes("shutdown ritual") ||
        !dlg.textContent.includes("close the day on purpose")
      ) {
        fails.push("dōjō: suggestion (with its reason line) missing");
      }
      if (!dlg.querySelector('button[aria-label^="Adopt kata: read 10 pages"]')) {
        fails.push("dōjō: library chips missing");
      }
      const puts = () => posts.filter((u) => u.includes("/api/state")).length;
      let before = puts();
      const adopt = dlg.querySelector('button[aria-label="Adopt kata: shutdown ritual"]');
      await act(async () => adopt?.click());
      await new Promise((r) => setTimeout(r, 150));
      if (puts() !== before + 1) {
        fails.push("dōjō: adopting a suggestion didn't PUT the state");
      }
      before = puts();
      const retire = dlg.querySelector('button[aria-label="Retire greyscale phone"]');
      await act(async () => retire?.click());
      await new Promise((r) => setTimeout(r, 150));
      if (puts() !== before + 1) {
        fails.push("dōjō: retiring didn't PUT the state");
      }
      // your own: inline add (title only) → one more PUT
      const input = dlg.querySelector('input[aria-label="New kata"]');
      const setValue = (el, v) => {
        Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(
          el,
          v,
        );
        el.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      };
      await act(async () => setValue(input, "stretch before sitting down"));
      before = puts();
      const add = dlg.querySelector('button[aria-label="Add kata"]');
      await act(async () => add?.click());
      await new Promise((r) => setTimeout(r, 150));
      if (puts() !== before + 1) {
        fails.push("dōjō: adding a custom kata didn't PUT the state");
      }
      // the retired pile unfolds, cap-aware re-activate + delete in reach
      const retiredToggle = [...dlg.querySelectorAll("button")].find((b) =>
        b.textContent.includes("retired ·"),
      );
      await act(async () => retiredToggle?.click());
      if (!dlg.querySelector('button[aria-label="Re-activate phone in another room"]')) {
        fails.push("dōjō: retired pile missing its re-activate affordance");
      }
      if (!fails.some((f) => f.startsWith("dōjō"))) {
        console.log("  ✓ dōjō sheet: suggestion+library adopt, retire, custom add, retired pile");
      }
      const close = dlg.querySelector('button[aria-label="Close"]');
      await act(async () => close?.click());
      await new Promise((r) => setTimeout(r, 80));
    }
  }
} catch (e) {
  fails.push(`dōjō: ${e.message}`);
}

// backlog sheet: opens from Today, lists the stubbed task, stays open for the
// a11y scan below so its rows get checked too
try {
  const openBtn = [...document.querySelectorAll("main button")].find((b) =>
    b.textContent.includes("All tasks"),
  );
  if (!openBtn) {
    fails.push("backlog: no 'All tasks' button on Today");
  } else {
    await act(async () => openBtn.click());
    await new Promise((r) => setTimeout(r, 100));
    const dlg = document.querySelector('[role="dialog"]');
    if (!dlg) {
      fails.push("backlog: sheet didn't open");
    } else if (!dlg.textContent.includes("Read datasheet")) {
      fails.push("backlog: task row missing");
    } else {
      console.log("  ✓ backlog sheet lists tasks");
    }
  }
} catch (e) {
  fails.push(`backlog: ${e.message}`);
}

// lightweight accessibility scan: every control needs an accessible name
try {
  const accessibleName = (el) =>
    (el.getAttribute("aria-label") || el.textContent || el.getAttribute("title") || "").trim();
  const buttons = [...document.querySelectorAll("button")];
  const namelessButtons = buttons.filter((b) => !accessibleName(b));
  if (namelessButtons.length) {
    fails.push(`a11y: ${namelessButtons.length} button(s) without an accessible name`);
  }
  const fields = [...document.querySelectorAll("input, select, textarea")];
  const namelessFields = fields.filter((f) => {
    if (f.getAttribute("aria-label") || f.getAttribute("placeholder")) {
      return false;
    }
    const id = f.getAttribute("id");
    const labelled = id && document.querySelector(`label[for="${id}"]`);
    const wrapped = f.closest("label");
    return !labelled && !wrapped;
  });
  if (namelessFields.length) {
    fails.push(`a11y: ${namelessFields.length} form field(s) without a label`);
  }
  if (!namelessButtons.length && !namelessFields.length) {
    console.log(`  ✓ a11y: ${buttons.length} buttons + ${fields.length} fields all named`);
  }
} catch (e) {
  fails.push(`a11y scan: ${e.message}`);
}

// winding path view: the default roadmap detail — every step is a labelled node
// button climbing bottom→top, the companion stands on the frontier, and the
// list/path toggle swaps back to the classic edit affordances
try {
  // close the backlog sheet the a11y scan left open, then head to Roadmaps
  const sheetClose = document.querySelector('[role="dialog"] button[aria-label="Close"]');
  await act(async () => sheetClose?.click());
  await navTo("Roadmaps");
  const labels = [...document.querySelectorAll("main button[aria-label]")].map((b) =>
    b.getAttribute("aria-label"),
  );
  const want = ["GPIO — done", "UART — in progress", "SPI — to do"];
  const missing = want.filter((w) => !labels.includes(w));
  const nameless = [...document.querySelectorAll("main button")].filter(
    (b) => !(b.getAttribute("aria-label") || b.textContent || "").trim(),
  );
  if (missing.length) {
    fails.push(`path view: node labels missing: ${missing.join(", ")}`);
  } else if (nameless.length) {
    fails.push(`path view a11y: ${nameless.length} unnamed button(s) on Roadmaps`);
  } else if (!document.querySelector("main .mascot-svg")) {
    fails.push("path view: no companion standing on the frontier node");
  } else {
    console.log("  ✓ path view: every node labelled + companion on the frontier");
  }
  const listBtn = [...document.querySelectorAll('main [aria-label="Roadmap view"] button')].find(
    (b) => b.textContent === "list",
  );
  if (!listBtn) {
    fails.push("path view: no path/list toggle");
  } else {
    await act(async () => listBtn.click());
    await new Promise((r) => setTimeout(r, 80));
    if (!document.querySelector('button[title="Delete step"]')) {
      fails.push("path view: list mode didn't bring back the edit affordances");
    } else {
      console.log("  ✓ view toggle: list mode restores edit/reorder affordances");
    }
  }
} catch (e) {
  fails.push(`path view: ${e.message}`);
}

// delete a step → the PUT's `trashed` receipt drives the undo toast, which sits
// above modals (z-[60]) and restores EVERY receipt row on Undo
try {
  await navTo("Roadmaps");
  const del = document.querySelector('button[title="Delete step"]');
  if (!del) {
    fails.push("undo toast: no step delete button on Roadmaps");
  } else {
    posts.length = 0;
    await act(async () => del.click()); // arms the two-tap confirm…
    await act(async () => del.click()); // …and fires the delete PUT
    await new Promise((r) => setTimeout(r, 150));
    const toast = [...document.querySelectorAll('[role="status"]')].find((el) =>
      el.textContent.includes("Deleted"),
    );
    if (!toast || !toast.textContent.includes("Deleted 2 items")) {
      fails.push("undo toast: didn't show the PUT's trash receipt (plural form)");
    } else if (!toast.className.includes("z-[60]")) {
      fails.push("undo toast: must sit above modals (z-[60])");
    } else {
      const undoBtn = [...toast.querySelectorAll("button")].find((b) =>
        b.textContent.includes("Undo"),
      );
      await act(async () => undoBtn.click());
      await new Promise((r) => setTimeout(r, 150));
      const restores = posts.filter((u) => u.includes("/api/trash/restore"));
      if (restores.length !== 2) {
        fails.push(`undo toast: expected 2 restore calls, got ${restores.length}`);
      } else {
        console.log("  ✓ undo toast binds the PUT's receipt and restores every row");
      }
    }
  }
} catch (e) {
  fails.push(`undo toast: ${e.message}`);
}

if (errors.length) {
  fails.push(...errors.map((m) => `window error: ${m}`));
}

if (fails.length) {
  console.error("\nSMOKE FAILURES:\n - " + fails.join("\n - "));
  process.exit(1);
}
console.log("\nsmoke ok");
