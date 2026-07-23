import { useRef, useState } from "react";
import { Copy, Check, AlertTriangle } from "lucide-react";
import { Button } from "../ui.jsx";
import { api } from "../lib/api.js";

// clipboard with a fallback for non-secure contexts (a mini PC on plain http) —
// mirrors PlanWithClaude's helper (kept local, like markdown.js keeps its own copy)
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

/**
 * The WEEK round-trip, self-contained: copy the week prompt, paste Claude's reply,
 * preview the areas, apply (which replaces the chosen week's plan). Owns its state;
 * a successful apply calls ctx.refresh() so the app adopts the new state.
 */
export default function PlanWeekWithClaude({ ctx, weekStart }) {
  const { refresh } = ctx;
  const [md, setMd] = useState("");
  const [preview, setPreview] = useState(null);
  const [synced, setSynced] = useState(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const guard = useRef(false);

  const copyExport = async () => {
    if (guard.current) {
      return;
    }
    guard.current = true;
    try {
      await copyText(await api.week.exportMd(weekStart));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      setErr(null);
    } catch (e) {
      setErr(e.message || "export failed");
    }
    guard.current = false;
  };

  const previewSync = async () => {
    if (guard.current || !md.trim()) {
      return;
    }
    guard.current = true;
    setBusy(true);
    try {
      setPreview(await api.week.preview(md));
      setSynced(null);
      setErr(null);
    } catch (e) {
      setPreview(null);
      setErr(e.message || "couldn't read that plan");
    }
    guard.current = false;
    setBusy(false);
  };

  const applyNow = async () => {
    if (guard.current) {
      return;
    }
    guard.current = true;
    setBusy(true);
    try {
      const res = await api.week.apply(md, weekStart);
      await refresh();
      const n = res.applied?.areas ?? 0;
      setSynced(`Saved this week — ${n} area${n === 1 ? "" : "s"}.`);
      setMd("");
      setPreview(null);
      setErr(null);
    } catch (e) {
      setErr(e.message || "couldn't save that week");
    }
    guard.current = false;
    setBusy(false);
  };

  return (
    <div>
      <p className="mb-2 text-xs text-slate-500">
        Talk the week through with Claude, then paste its plan back — it replaces this week’s areas.
      </p>
      <Button variant="ghost" onClick={copyExport} className="w-full">
        {copied ? (
          <Check size={15} className="text-trail-700 dark:text-trail-400" />
        ) : (
          <Copy size={15} />
        )}
        {copied ? "Copied ✓" : "Copy week prompt for Claude"}
      </Button>

      <textarea
        rows={6}
        value={md}
        onChange={(e) => {
          setMd(e.target.value);
          setPreview(null);
          setSynced(null);
        }}
        placeholder="Paste Claude's week plan here to save it…"
        aria-label="Claude's week plan"
        className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-800 placeholder:text-slate-400 focus:border-trail-400 focus:outline-none focus:ring-2 focus:ring-trail-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-trail-800"
      />

      {preview ? (
        <div className="mt-2 space-y-2 rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
          {preview.areas?.length ? (
            <ul className="space-y-1 text-xs text-slate-600 dark:text-slate-300">
              {preview.areas.map((a, i) => (
                <li key={i}>
                  <span className="font-medium text-slate-700 dark:text-slate-200">{a.area}</span>
                  {a.theme ? ` — ${a.theme}` : ""} · {a.days} day
                  {a.days === 1 ? "" : "s"} · {a.targets} target{a.targets === 1 ? "" : "s"}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-slate-500">No areas found in that plan.</p>
          )}
          {preview.warnings?.length ? (
            <ul className="space-y-0.5 text-xs text-amber-600 dark:text-amber-500">
              {preview.warnings.map((w, i) => (
                <li key={i}>⚠ {w}</li>
              ))}
            </ul>
          ) : null}
          <div className="flex gap-2 pt-1">
            <Button onClick={applyNow} disabled={busy} className="flex-1">
              Save this week
            </Button>
            <Button variant="ghost" onClick={() => setPreview(null)} className="flex-1">
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="subtle"
          onClick={previewSync}
          disabled={busy || !md.trim()}
          className="mt-2 w-full"
        >
          Preview week plan
        </Button>
      )}

      {synced ? (
        <p role="status" className="mt-2 text-sm text-trail-700 dark:text-trail-400">
          {synced}
        </p>
      ) : null}
      {err ? (
        <p className="mt-2 flex items-center gap-1.5 text-sm text-amber-700 dark:text-amber-400">
          <AlertTriangle size={14} /> {err}
        </p>
      ) : null}
    </div>
  );
}
