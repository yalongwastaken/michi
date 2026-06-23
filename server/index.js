// index.js — the mini-PC brain. Express API + serves the built client.
// Bind to 0.0.0.0 so it's reachable over the LAN / Tailscale (never exposed publicly).
import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import {
  getState,
  putState,
  validateState,
  validateTask,
  addTask,
  setDone,
  resetAll,
  replaceCompletions,
  ConflictError,
} from "./db.js";
import { buildToday, momentum } from "./engine.js";
import { planDay } from "./planner.js";
import { aiConfig, refinePlan } from "./suggest.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.disable("x-powered-by"); // don't advertise the framework
app.use(express.json({ limit: "5mb" }));

// CSRF / DNS-rebinding guard: a browser sends Origin on cross-site writes. If a
// mutating request carries an Origin whose host isn't ours, reject it — this stops
// a malicious page on the tailnet from POSTing /api/reset etc. Same-origin app
// fetches (Origin === Host) and non-browser tools (no Origin) pass through.
app.use((req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    return next();
  }
  const origin = req.get("origin");
  if (origin) {
    let host;
    try {
      host = new URL(origin).host;
    } catch {
      return res.status(403).json({ error: "bad origin" });
    }
    if (host !== req.get("host")) {
      return res.status(403).json({ error: "cross-origin request blocked" });
    }
  }
  next();
});

// ── API ─────────────────────────────────────────────────────────────────────
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// client capability probe — lets the UI show the "Smarter plan" action only when a
// local model is configured. Reports model name but never any secrets.
app.get("/api/config", (_req, res) => {
  const cfg = aiConfig();
  res.json({ ai: cfg.enabled, model: cfg.enabled ? cfg.model : null });
});

// full model (client loads this once on boot)
app.get("/api/state", (_req, res) => res.json(getState()));

// pragmatic full-state replace (client's "save" — see db.js)
app.put("/api/state", (req, res) => {
  const body = req.body || {};
  const bad = validateState(body);
  if (bad) {
    return res.status(400).json({ error: bad });
  }
  try {
    res.json(putState(body, body.rev));
  } catch (e) {
    if (e instanceof ConflictError) {
      return res.status(409).json({ error: e.message, state: getState() });
    }
    console.warn("PUT /api/state failed:", e.message);
    res.status(400).json({ error: "could not save — check your data" });
  }
});

// append a single task (the common case — no full-state PUT, no rev clash)
app.post("/api/tasks", (req, res) => {
  const t = req.body || {};
  const bad = validateTask(t);
  if (bad) {
    return res.status(400).json({ error: bad });
  }
  try {
    res.json(addTask(t));
  } catch (e) {
    console.warn("POST /api/tasks failed:", e.message);
    res.status(400).json({ error: "could not add that task" });
  }
});

// toggle completion of a task or a step (the core daily interaction)
app.post("/api/complete", (req, res) => {
  const { kind, id, done = true } = req.body || {};
  if (kind !== "task" && kind !== "step") {
    return res.status(400).json({ error: "kind must be 'task' or 'step'" });
  }
  if (!id) {
    return res.status(400).json({ error: "id is required" });
  }
  try {
    res.json(setDone(kind, id, !!done));
  } catch (e) {
    console.warn("POST /api/complete failed:", e.message);
    res.status(404).json({ error: "could not find that item" });
  }
});

// the daily queue — "what should I work on today?"
app.get("/api/today", (req, res) => {
  const today = typeof req.query.day === "string" ? req.query.day : undefined;
  const limit = Number(req.query.limit);
  res.json(buildToday(getState(), { today, limit: Number.isFinite(limit) ? limit : undefined }));
});

// momentum: streak, heatmap, roadmap/project progress
app.get("/api/momentum", (req, res) => {
  const today = typeof req.query.day === "string" ? req.query.day : undefined;
  res.json(momentum(getState(), { today }));
});

// the planner — a doable day from the whole picture. Deterministic by default;
// with ?ai=1 (and MICHI_LLM enabled) a local model refines it, falling back to the
// deterministic plan on any hiccup.
app.get("/api/plan", async (req, res, next) => {
  try {
    const state = getState();
    const s = state.settings || {};
    const day = typeof req.query.day === "string" ? req.query.day : undefined;
    const qBudget = Number(req.query.budget);
    const o = {
      today: day,
      budgetMin: Number.isFinite(qBudget) ? qBudget : s.dailyMinutes,
      defaultStepMin: s.defaultStepMin,
      taskDefaultMin: s.taskDefaultMin,
    };
    const plan = planDay(state, o);
    const wantAi = req.query.ai === "1" || req.query.ai === "true";
    res.json(wantAi ? await refinePlan(state, plan, { ...o, budgetMin: plan.budgetMin }) : plan);
  } catch (e) {
    next(e);
  }
});

// wipe everything and start fresh (the Settings "danger zone")
app.post("/api/reset", (_req, res) => res.json(resetAll()));

// data export (download the whole dataset) + import (validated full replace)
app.get("/api/export", (_req, res) => {
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="michi-${new Date().toISOString().slice(0, 10)}.json"`,
  );
  res.json(getState());
});
app.post("/api/import", (req, res) => {
  const body = req.body || {};
  const bad = validateState(body);
  if (bad) {
    return res.status(400).json({ error: bad });
  }
  try {
    putState(body); // no rev check — deliberate replace
    // import is the one path that rebuilds server-owned activity history, so a
    // restored backup brings streaks/heatmap back too
    res.json(replaceCompletions(body.completions || []));
  } catch (e) {
    console.warn("POST /api/import failed:", e.message);
    res.status(400).json({ error: "import failed — file may be malformed" });
  }
});

// unknown API paths get a clean 404 (not the SPA shell)
app.use("/api", (_req, res) => res.status(404).json({ error: "not found" }));

// ── serve the built client (client/dist) if present ──────────────────────────
const dist = join(__dirname, "..", "client", "dist");
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get("*", (_req, res) => res.sendFile(join(dist, "index.html")));
}

// terminal error handler — turns thrown/rejected route errors into a clean 500
app.use((err, _req, res, _next) => {
  console.warn("unhandled route error:", err?.message || err);
  if (!res.headersSent) {
    const status = err?.status || err?.statusCode || 500;
    res.status(status >= 400 && status < 600 ? status : 500).json({
      error: status >= 400 && status < 500 ? "bad request" : "server error",
    });
  }
});

const PORT = process.env.PORT || 4001;
const HOST = process.env.HOST || "0.0.0.0";
app.listen(PORT, HOST, () => console.log(`michi server on http://${HOST}:${PORT}`));
