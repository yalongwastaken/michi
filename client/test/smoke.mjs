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
  profile: { name: "Sam", onboarded: true, focusAreas: [] },
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
  },
  plan: PLAN,
  insights: [{ kind: "deadline", tone: "warn", text: "Embedded: 8 days left, ~1/day to finish." }],
};

// what a delete PUT reports as trashed — two rows, so the toast's plural path
// ("Deleted 2 items") and the restore-them-all undo get exercised
const TRASHED = [
  { id: "tr_a", kind: "step", title: "SPI" },
  { id: "tr_b", kind: "task", title: "Read datasheet" },
];

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
    body = DASH;
  } else if (u.includes("/api/plan")) {
    body = PLAN;
  } else if (u.includes("/api/momentum")) {
    body = DASH.momentum;
  } else if (u.includes("/api/today")) {
    body = DASH.today;
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

const navTo = async (label) => {
  const nav = document.querySelector("nav");
  const b = [...(nav?.querySelectorAll("button") || [])].find((x) => x.textContent.includes(label));
  if (!b) {
    return false;
  }
  await act(async () => b.click());
  await new Promise((r) => setTimeout(r, 120));
  return true;
};

for (const name of ["Roadmaps", "Projects", "Momentum", "Today"]) {
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

// delete a step → the PUT's `trashed` receipt drives the undo toast, which sits
// above modals (z-[60]) and restores EVERY receipt row on Undo
try {
  // close the backlog sheet the a11y scan left open, then head to Roadmaps
  const sheetClose = document.querySelector('[role="dialog"] button[aria-label="Close"]');
  await act(async () => sheetClose?.click());
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
