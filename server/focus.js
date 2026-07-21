// focus.js — opt-in Web Push for the Pomodoro/Focus tab ("Michi taps you when the
// block ends"). A device subscribes from Settings → Notifications; when you start a
// focus block the client schedules a reminder for its end time, and a small server
// loop sends one push when it comes due — so the alert lands even if the app is
// backgrounded or the phone is asleep.
//
// Mirrors tsumiki's push design (server/lib/push.js): VAPID keys generated once and
// persisted, subscriptions in the meta table (validated hard — HTTPS-only endpoints,
// length caps, bounded count — so a client can't point the server at arbitrary URLs),
// and dead subscriptions (404/410/403) pruned on send. No subscriptions → no outbound
// calls at all, so opt-in stays true.
import webpush from "web-push";
import {
  getVapid,
  setVapid,
  getPushSubs,
  setPushSubs,
  getFocusReminders,
  setFocusReminders,
} from "./db.js";
import { aiConfig } from "./suggest.js";

const TICK_EVERY_MS = 15 * 1000; // the countdown is short — check often
const MAX_SUBS = 20; // one user's devices; more is abuse
const MAX_FIELD = 2048; // endpoints/keys are well under this in every browser
const MAX_REMINDERS = 50; // a runaway client can't fill the meta blob
const REMINDER_GRACE_MS = 10 * 60 * 1000; // a due reminder older than this is stale — drop unsent

/** Lazily create + persist the VAPID keypair (first subscribe generates it). */
export function vapidKeys() {
  let keys = getVapid();
  if (!keys?.publicKey || !keys?.privateKey) {
    keys = webpush.generateVAPIDKeys();
    setVapid(keys);
  }
  return keys;
}

/** Register a device subscription (idempotent by endpoint).
 * The endpoint is a URL the server will POST to later, so it's validated hard:
 * HTTPS only, length-capped, string keys, bounded count. Without this a subscribed
 * client could point the server at arbitrary URLs (stored SSRF, incl. its own API). */
export function addSubscription(sub) {
  const { endpoint, keys } = sub || {};
  if (
    typeof endpoint !== "string" ||
    !endpoint ||
    endpoint.length > MAX_FIELD ||
    typeof keys?.p256dh !== "string" ||
    !keys.p256dh ||
    keys.p256dh.length > MAX_FIELD ||
    typeof keys?.auth !== "string" ||
    !keys.auth ||
    keys.auth.length > MAX_FIELD
  ) {
    return { error: "subscription needs an endpoint and string keys" };
  }
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    return { error: "endpoint must be a valid URL" };
  }
  if (url.protocol !== "https:") {
    return { error: "endpoint must be https" }; // every real push service is
  }
  const subs = getPushSubs().filter((s) => s.endpoint !== endpoint);
  if (subs.length >= MAX_SUBS) {
    return { error: `too many subscriptions (max ${MAX_SUBS}) — unsubscribe a device first` };
  }
  subs.push({ endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } });
  setPushSubs(subs);
  return { ok: true, count: subs.length };
}

/** Remove a device subscription by endpoint. */
export function removeSubscription(endpoint) {
  const subs = getPushSubs();
  const kept = subs.filter((s) => s.endpoint !== endpoint);
  setPushSubs(kept);
  return { ok: true, removed: subs.length - kept.length };
}

export const subscriptionCount = () => getPushSubs().length;

/** Schedule a reminder to fire at `dueAt` (epoch ms). Returns the reminder id so the
 * client can cancel it if the block is paused or reset. `now` is injectable for tests. */
export function scheduleReminder({ dueAt, title, body }, now = Date.now()) {
  const due = Number(dueAt);
  if (!Number.isFinite(due)) {
    return { error: "dueAt must be a timestamp (ms)" };
  }
  // bound it: no scheduling in the past, and nothing more than a day out (a focus
  // block is minutes — a far-future timestamp is a bug or abuse)
  if (due < now - 1000 || due > now + 24 * 60 * 60 * 1000) {
    return { error: "dueAt must be within the next 24 hours" };
  }
  // a unique id (list-length-derived ids collide after a cancel → cancel could drop
  // the wrong reminder). randomUUID is always available on Node ≥18's global crypto.
  const id = `focus_${globalThis.crypto.randomUUID().slice(0, 12)}`;
  const list = getFocusReminders().filter((r) => r.dueAt > now - REMINDER_GRACE_MS); // prune stale
  if (list.length >= MAX_REMINDERS) {
    return { error: "too many pending reminders" };
  }
  list.push({
    id,
    dueAt: due,
    title: String(title || "Focus block done").slice(0, 120),
    body: String(body || "Time's up — take a break or start the next block.").slice(0, 240),
  });
  setFocusReminders(list);
  return { ok: true, id };
}

/** Cancel a scheduled reminder by id (no-op if already fired/gone). */
export function cancelReminder(id) {
  const list = getFocusReminders();
  const kept = list.filter((r) => r.id !== id);
  setFocusReminders(kept);
  return { ok: true, removed: list.length - kept.length };
}

/** Send `payload` to every subscription, pruning ones the browser revoked. */
export async function sendToAll(payload) {
  const subs = getPushSubs();
  if (!subs.length) {
    return { sent: 0, pruned: 0 };
  }
  const keys = vapidKeys();
  webpush.setVapidDetails("mailto:michi@localhost", keys.publicKey, keys.privateKey);
  const body = JSON.stringify(payload);
  let sent = 0;
  const dead = new Set();
  for (const sub of subs) {
    try {
      // timeout so a hung/slow push endpoint can't stall the whole tick loop
      await webpush.sendNotification(sub, body, { TTL: 10 * 60, timeout: 10000 });
      sent++;
    } catch (e) {
      // 404/410 = expired/revoked; 403 = key mismatch (VAPID pair regenerated) —
      // none will ever succeed again, so prune all three instead of warning forever
      if (e?.statusCode === 404 || e?.statusCode === 410 || e?.statusCode === 403) {
        dead.add(sub.endpoint);
      } else {
        console.warn("focus push: send failed:", e?.statusCode || e?.message || e);
      }
    }
  }
  if (dead.size) {
    setPushSubs(subs.filter((s) => !dead.has(s.endpoint)));
  }
  return { sent, pruned: dead.size };
}

/** One scheduler tick: fire (and clear) every reminder now due, drop stale ones.
 * `now` is injectable for tests. Returns a summary of what happened. */
export async function focusTick(now = Date.now()) {
  const list = getFocusReminders();
  if (!list.length) {
    return null;
  }
  const due = list.filter((r) => r.dueAt <= now);
  const pending = list.filter((r) => r.dueAt > now);
  if (!due.length) {
    return null;
  }
  // a reminder that came due while the server was down (older than the grace window)
  // is stale — the moment has passed, so drop it silently instead of a late buzz
  const fresh = due.filter((r) => r.dueAt >= now - REMINDER_GRACE_MS);
  // clear the whole due set FIRST so a send that throws systemically can't replay it
  setFocusReminders(pending);
  let sent = 0;
  for (const r of fresh) {
    const out = await sendToAll({ title: r.title, body: r.body, tag: "michi-focus" });
    sent += out.sent;
  }
  return { fired: fresh.length, stale: due.length - fresh.length, sent };
}

/** Start the focus-reminder push loop (no-op work when nothing is pending). */
export function scheduleFocusLoop() {
  focusTick().catch(() => {});
  return setInterval(() => focusTick().catch(() => {}), TICK_EVERY_MS);
}

// ── study-block goal suggestion ─────────────────────────────────────────────────
// `targets` are today's candidate tasks/steps the client already renders:
// [{ kind, id, title, topic? }]. The deterministic phrasing always works; the local
// model (when on) turns the same list into a warmer one-line intention.

// keep a stray giant title from bloating the prompt (or the fallback line)
const cleanTitle = (t) => (typeof t === "string" ? t : "").trim().slice(0, 200);

/** A plain, always-available goal line from the chosen (or top) targets. */
export function deterministicGoal(targets = []) {
  const titles = targets.map((t) => cleanTitle(t?.title)).filter(Boolean);
  if (!titles.length) {
    return "A focused block of deep work.";
  }
  if (titles.length === 1) {
    return `Make progress on “${titles[0]}”.`;
  }
  const head = titles.slice(0, 3);
  return `Work through ${head.map((t) => `“${t}”`).join(", ")}${titles.length > head.length ? ", and a bit more" : ""}.`;
}

/**
 * Suggest a one-line focus-block goal. Uses the local model (Ollama) when enabled
 * and reachable; otherwise (and on any error/timeout) falls back to deterministicGoal
 * so the button always returns something. Never throws.
 * @param deps injectable transport for tests ({ fetch })
 */
export async function suggestFocusGoal(targets = [], deps = {}) {
  const fallback = deterministicGoal(targets);
  const cfg = aiConfig();
  if (!cfg.enabled) {
    return fallback;
  }
  const doFetch = deps.fetch || globalThis.fetch;
  let endpoint;
  try {
    endpoint = new URL("/api/chat", cfg.url).toString();
  } catch {
    return fallback;
  }
  const list = targets
    .map((t) => cleanTitle(t?.title))
    .filter(Boolean)
    .map((t) => `- ${t}`)
    .join("\n");
  const system = [
    "You help a learner set the intention for a single focused study block (a Pomodoro).",
    "Given the tasks/steps they plan to work on, reply with ONE short, concrete sentence",
    "naming what to accomplish this block. No preamble, no quotes, no list — just the sentence.",
  ].join("\n");
  const user = list
    ? `Tasks for this block:\n${list}`
    : "No specific tasks — suggest a deep-work block.";
  try {
    const res = await doFetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: cfg.model,
        stream: false,
        options: { temperature: 0.4 },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(deps.timeoutMs || 20000),
    });
    if (!res.ok) {
      return fallback;
    }
    const data = await res.json();
    const line = String(data?.message?.content || "")
      .replace(/^["'\s]+|["'\s]+$/g, "")
      .split("\n")[0]
      .trim();
    return line || fallback;
  } catch {
    return fallback;
  }
}
