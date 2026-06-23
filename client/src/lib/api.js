// api.js — the only place that talks to the backend. Thin wrappers over fetch
// with consistent error handling. Same-origin in prod; Vite proxies /api in dev.

async function req(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
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

export const api = {
  health: () => req("/api/health"),
  getState: () => req("/api/state"),
  putState: (state) => req("/api/state", { method: "PUT", body: JSON.stringify(state) }),
  addTask: (task) => req("/api/tasks", { method: "POST", body: JSON.stringify(task) }),
  complete: (kind, id, done = true) =>
    req("/api/complete", { method: "POST", body: JSON.stringify({ kind, id, done }) }),
  today: (day) => req(`/api/today${day ? `?day=${day}` : ""}`),
  momentum: (day) => req(`/api/momentum${day ? `?day=${day}` : ""}`),
  config: () => req("/api/config"),
  plan: (day, { ai = false } = {}) => {
    const q = new URLSearchParams();
    if (day) {
      q.set("day", day);
    }
    if (ai) {
      q.set("ai", "1");
    }
    const qs = q.toString();
    return req(`/api/plan${qs ? `?${qs}` : ""}`);
  },
  reset: () => req("/api/reset", { method: "POST" }),
  importState: (state) => req("/api/import", { method: "POST", body: JSON.stringify(state) }),
};
