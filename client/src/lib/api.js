// api.js — the only place that talks to the backend. Thin wrappers over fetch
// with consistent error handling. Same-origin in prod; Vite proxies /api in dev.

async function req(path, opts = {}) {
  let res;
  try {
    res = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      ...opts,
    });
  } catch (cause) {
    // fetch()'s raw "Failed to fetch" means nothing to users — translate it once, here
    const err = new Error("can't reach the server — check your connection");
    err.network = true;
    err.cause = cause;
    throw err;
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* empty / non-JSON body */
  }
  if (!res.ok) {
    const err = new Error(body?.error || `request failed (${res.status})`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

// raw-text sibling of req() for endpoints that serve markdown, not JSON
async function reqText(path) {
  let res;
  try {
    res = await fetch(path);
  } catch (cause) {
    const err = new Error("can't reach the server — check your connection");
    err.network = true;
    err.cause = cause;
    throw err;
  }
  if (!res.ok) {
    const err = new Error(`request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return res.text();
}

export const api = {
  getState: () => req("/api/state"),
  putState: (state) => req("/api/state", { method: "PUT", body: JSON.stringify(state) }),
  addTask: (task) => req("/api/tasks", { method: "POST", body: JSON.stringify(task) }),
  complete: (kind, id, done = true) =>
    req("/api/complete", { method: "POST", body: JSON.stringify({ kind, id, done }) }),
  // honor (or unhonor) a kata for today — the kata sibling of complete().
  // Resolves to the slim state plus a fresh `kataToday` block for reconciling.
  kataHonor: (id, on = true) =>
    req("/api/kata/honor", { method: "POST", body: JSON.stringify({ id, on }) }),
  config: () => req("/api/config"),
  // the Today screen pulls queue + momentum + plan + nudges + review in one round-trip;
  // {budget} carries the day's "one more" boost so the rebuilt plan keeps its size
  dashboard: (day, { budget } = {}) => {
    const q = new URLSearchParams();
    if (day) {
      q.set("day", day);
    }
    if (Number.isFinite(budget)) {
      q.set("budget", String(budget));
    }
    const qs = q.toString();
    return req(`/api/dashboard${qs ? `?${qs}` : ""}`);
  },
  plan: (day, { ai = false, budget } = {}) => {
    const q = new URLSearchParams();
    if (day) {
      q.set("day", day);
    }
    if (ai) {
      q.set("ai", "1");
    }
    if (Number.isFinite(budget)) {
      q.set("budget", String(budget));
    }
    const qs = q.toString();
    return req(`/api/plan${qs ? `?${qs}` : ""}`);
  },
  skipPlanItem: (kind, id, day, on = true) =>
    req("/api/plan/skip", { method: "POST", body: JSON.stringify({ kind, id, day, on }) }),
  // trash: the safety net under deletes — list, restore one, purge one, empty all.
  // restore returns { state, restored: {id, kind, title, remapped} }.
  trash: () => req("/api/trash"),
  trashRestore: (id) => req("/api/trash/restore", { method: "POST", body: JSON.stringify({ id }) }),
  trashDelete: (id) => req(`/api/trash/${encodeURIComponent(id)}`, { method: "DELETE" }),
  trashEmpty: () => req("/api/trash", { method: "DELETE" }),
  // backups: the nightly snapshot folder — list it, or take a snapshot right now.
  // backupNow resolves to the new file's entry: { file, sizeBytes, mtime }.
  backups: () => req("/api/backups"),
  backupNow: () => req("/api/backup", { method: "POST" }),
  reset: () => req("/api/reset", { method: "POST" }),
  importState: (state) => req("/api/import", { method: "POST", body: JSON.stringify(state) }),
  // the Claude round-trip: export markdown, preview a pasted reply, apply it
  exportMd: () => reqText("/api/export.md"),
  syncPreview: (markdown) =>
    req("/api/sync/preview", { method: "POST", body: JSON.stringify({ markdown }) }),
  syncApply: (markdown) =>
    req("/api/sync/apply", { method: "POST", body: JSON.stringify({ markdown }) }),
  // the WEEK-planning round-trip: export a week prompt, preview + apply a pasted reply
  week: {
    exportMd: (weekStart) =>
      reqText(`/api/week/export.md?weekStart=${encodeURIComponent(weekStart)}`),
    preview: (markdown) =>
      req("/api/week/sync/preview", { method: "POST", body: JSON.stringify({ markdown }) }),
    apply: (markdown, weekStart) =>
      req("/api/week/sync/apply", {
        method: "POST",
        body: JSON.stringify({ markdown, weekStart }),
      }),
  },
  // daily journal / time log
  journal: {
    list: (from, to) =>
      req(`/api/journal?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
    add: (entry) => req("/api/journal", { method: "POST", body: JSON.stringify(entry) }),
    update: (id, patch) =>
      req(`/api/journal/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    remove: (id) => req(`/api/journal/${encodeURIComponent(id)}`, { method: "DELETE" }),
  },
  // web push (Focus-tab reminders) — the VAPID key, plus per-device sub/unsub
  push: {
    key: () => req("/api/push/key"),
    subscribe: (sub) => req("/api/push/subscribe", { method: "POST", body: JSON.stringify(sub) }),
    unsubscribe: (endpoint) =>
      req("/api/push/unsubscribe", { method: "POST", body: JSON.stringify({ endpoint }) }),
  },
  // focus (Pomodoro): schedule/cancel the end-of-block push, and get a goal suggestion
  focus: {
    schedule: (reminder) =>
      req("/api/focus/schedule", { method: "POST", body: JSON.stringify(reminder) }),
    cancel: (id) => req("/api/focus/cancel", { method: "POST", body: JSON.stringify({ id }) }),
    suggest: (targets) =>
      req("/api/focus/suggest", { method: "POST", body: JSON.stringify({ targets }) }),
  },
};
