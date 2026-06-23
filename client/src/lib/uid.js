// uid.js — short, collision-resistant ids for client-created rows.
export function uid(prefix = "") {
  const rnd =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return prefix ? `${prefix}_${rnd.slice(0, 8)}` : rnd;
}
