import { useRef, useState } from "react";
import { Copy, Check, AlertTriangle, Sparkles } from "lucide-react";
import { Button } from "../ui.jsx";
import { api } from "../lib/api.js";

// clipboard with a fallback for non-secure contexts (a mini PC on plain http)
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

// "1 roadmap · 12 steps · 5 tasks" from a {kind: n} (or {kind: {count}}) map.
// "kata" is its own plural (mirror of server/markdown.js) — never "2 katas".
function countsLabel(obj, pick = (v) => v) {
  const parts = [];
  for (const [kind, v] of Object.entries(obj || {})) {
    const n = pick(v);
    if (n > 0) {
      const noun = kind.replace(/s$/, "");
      parts.push(`${n} ${noun}${n > 1 && noun !== "kata" ? "s" : ""}`);
    }
  }
  return parts.join(" · ");
}

/**
 * The Claude round-trip, self-contained: copy the export prompt, paste Claude's
 * reply, preview the diff, apply it. Reused in Settings and on the Today tab. Owns
 * its own state + error line; on a successful apply it calls ctx.refresh() so the
 * whole app adopts the new state.
 */
export default function PlanWithClaude({ ctx }) {
  const { refresh, aiEnabled } = ctx;
  const [md, setMd] = useState("");
  const [preview, setPreview] = useState(null);
  const [synced, setSynced] = useState(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const guard = useRef(false); // blocks a double tap from previewing/applying twice

  // draft-from-source (local model): paste raw notes, let MICHI_LLM structure them
  const [source, setSource] = useState("");
  const [mode, setMode] = useState("roadmap");
  const [drafting, setDrafting] = useState(false);

  const copyExport = async () => {
    if (guard.current) {
      return;
    }
    guard.current = true;
    try {
      await copyText(await api.exportMd());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      setErr(null);
    } catch (e) {
      setErr(e.message || "export failed");
    }
    guard.current = false;
  };

  // mdArg lets the draft step preview its result without waiting on state to settle;
  // an onClick passes an event, so only a real string overrides md
  const previewSync = async (mdArg) => {
    const text = typeof mdArg === "string" ? mdArg : md;
    if (guard.current || !text.trim()) {
      return;
    }
    guard.current = true;
    setBusy(true);
    try {
      setPreview(await api.syncPreview(text));
      setSynced(null);
      setErr(null);
    } catch (e) {
      setPreview(null);
      setErr(e.message || "couldn't read that plan");
    }
    guard.current = false;
    setBusy(false);
  };

  // hand the pasted source to the local model, drop its draft into the editor, and
  // preview it right away so the diff is one glance from Apply
  const draft = async () => {
    if (drafting || !source.trim()) {
      return;
    }
    setDrafting(true);
    setErr(null);
    try {
      const { markdown } = await api.aiDraft(source, mode);
      setMd(markdown);
      setSynced(null);
      await previewSync(markdown);
    } catch (e) {
      setErr(e.message || "the local model couldn't draft that");
    }
    setDrafting(false);
  };

  const applySyncNow = async () => {
    if (guard.current) {
      return;
    }
    guard.current = true;
    setBusy(true);
    try {
      const res = await api.syncApply(md);
      await refresh(); // adopt the new state everywhere
      const bits = [
        countsLabel(res.applied?.createdCounts) &&
          `created ${countsLabel(res.applied?.createdCounts)}`,
        countsLabel(res.applied?.updatedCounts) &&
          `updated ${countsLabel(res.applied?.updatedCounts)}`,
      ].filter(Boolean);
      setSynced(`Synced — ${bits.join(" · ") || "nothing to change"}.`);
      setMd("");
      setPreview(null);
      setErr(null);
    } catch (e) {
      setErr(e.message || "sync failed");
    }
    guard.current = false;
    setBusy(false);
  };

  return (
    <div>
      {aiEnabled ? (
        <div className="mb-3 rounded-xl border border-iris-200/70 bg-iris-50/60 p-3 dark:border-iris-900/50 dark:bg-iris-950/30">
          <p className="mb-1 flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-200">
            <Sparkles size={15} className="text-iris-500 dark:text-iris-300" /> Draft from notes
          </p>
          <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
            Paste a syllabus, an article, or a brain dump — your local model turns it into a roadmap
            or tasks. You review the diff before anything saves.
          </p>
          <textarea
            rows={4}
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="Paste anything to turn into a plan…"
            aria-label="Source notes to draft from"
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:border-iris-400 focus:outline-none focus:ring-2 focus:ring-iris-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-iris-800"
          />
          <div className="mt-2 flex items-center gap-2">
            <div
              role="radiogroup"
              aria-label="What to draft"
              className="flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800"
            >
              {[
                ["roadmap", "Roadmap"],
                ["tasks", "Tasks"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={mode === id}
                  onClick={() => setMode(id)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                    mode === id
                      ? "bg-white text-iris-600 shadow-sm dark:bg-slate-900 dark:text-iris-300"
                      : "text-slate-500 dark:text-slate-400"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <Button
              variant="subtle"
              onClick={draft}
              disabled={drafting || !source.trim()}
              className="ml-auto"
            >
              <Sparkles size={14} /> {drafting ? "Drafting…" : "Draft with your model"}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        <Button variant="ghost" onClick={copyExport} className="flex-1">
          {copied ? (
            <Check size={15} className="text-trail-700 dark:text-trail-400" />
          ) : (
            <Copy size={15} />
          )}
          {copied ? "Copied ✓" : "Copy prompt for Claude"}
        </Button>
        <a
          href="/api/export.md"
          download
          className="shrink-0 text-xs text-slate-400 underline hover:text-trail-700 dark:hover:text-trail-400"
        >
          download instead
        </a>
      </div>

      <textarea
        rows={6}
        value={md}
        onChange={(e) => {
          setMd(e.target.value);
          setPreview(null); // an edited paste needs a fresh preview
          setSynced(null);
        }}
        placeholder="Paste Claude's reply here to save its changes…"
        aria-label="Claude's reply"
        className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-800 placeholder:text-slate-400 focus:border-trail-400 focus:outline-none focus:ring-2 focus:ring-trail-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-trail-800"
      />

      {preview ? (
        <div className="mt-2 space-y-2 rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
          {countsLabel(preview.creates, (v) => v.count) ? (
            <details>
              <summary className="cursor-pointer font-medium text-slate-700 dark:text-slate-200">
                Creates: {countsLabel(preview.creates, (v) => v.count)}
              </summary>
              <ul className="mt-1 space-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                {Object.entries(preview.creates).flatMap(([kind, v]) =>
                  (v.items || []).map((it) => (
                    <li key={`${kind}_${it.id}`}>
                      + {kind.replace(/s$/, "")} “{it.title}”
                    </li>
                  )),
                )}
              </ul>
            </details>
          ) : (
            <p className="text-slate-500">Nothing new to create.</p>
          )}
          {preview.updates?.length ? (
            <div>
              <p className="font-medium text-slate-700 dark:text-slate-200">
                Updates: {preview.updates.length}
              </p>
              <ul className="mt-1 space-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                {preview.updates.map((u) => (
                  <li key={`${u.kind}_${u.id}`}>
                    {u.kind} “{u.title}” —{" "}
                    {Object.entries(u.changes || {})
                      .map(([f, c]) => `${f}: ${c.from ?? "—"} → ${c.to ?? "—"}`)
                      .join(" · ")}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-xs text-slate-500">No updates to existing items.</p>
          )}
          {preview.warnings?.length ? (
            <ul className="space-y-0.5 text-xs text-amber-600 dark:text-amber-500">
              {preview.warnings.map((w, i) => (
                <li key={i}>⚠ {w}</li>
              ))}
            </ul>
          ) : null}
          <div className="flex gap-2 pt-1">
            <Button onClick={applySyncNow} disabled={busy} className="flex-1">
              Apply sync
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
          Preview sync
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
