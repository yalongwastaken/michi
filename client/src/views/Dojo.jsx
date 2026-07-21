// Dojo.jsx — 道場 dōjō, the training hall: one bottom sheet to manage the daily
// forms (型 kata). Active list with retire, data-driven suggestions, the builtin
// library, an inline "your own" add, and the retired pile (re-activate / delete).
// All edits are plain full-state saves; the server auto-trashes deleted rows
// (kind "kata"), so App's undo toast covers deletes. There's no cap on how many
// kata can be active — practice as many forms as you want to hold.
import { useRef, useState } from "react";
import { Plus, StickyNote, Sparkles, ChevronDown, ChevronRight, Trash2, Undo2 } from "lucide-react";
import { Modal, Button, Input, ConfirmButton } from "../ui.jsx";
import { KATA_LIBRARY } from "../lib/kata.js";
import { uid } from "../lib/uid.js";

const byPosition = (a, b) => (a.position ?? 0) - (b.position ?? 0);

// a fresh kata row for the state PUT — position lands after everything current
function newKata(s, { title, note = null, builtinId = null }) {
  const rows = s.kata || [];
  return {
    id: uid("kata"),
    title,
    note,
    builtinId,
    active: true,
    position: rows.reduce((m, k) => Math.max(m, (k.position ?? 0) + 1), 0),
    createdAt: new Date().toISOString(),
  };
}

function SectionHead({ children, right }) {
  return (
    <div className="flex items-baseline justify-between gap-2 px-1">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{children}</h3>
      {right ? <span className="text-xs text-slate-400">{right}</span> : null}
    </div>
  );
}

export default function Dojo({ ctx, onClose }) {
  const { state, save, busy, kataSuggestions } = ctx;
  const rows = state.kata || [];
  const active = rows.filter((k) => k.active).sort(byPosition);
  const retired = rows.filter((k) => !k.active).sort(byPosition);

  const hintOf = new Map(KATA_LIBRARY.map((k) => [k.id, k.hint]));
  // added-then-retired counts as "knows about it, chose not to" — same rule the
  // server's suggestions follow, so the library never re-offers an adopted form
  const known = new Set(rows.map((k) => k.builtinId).filter(Boolean));
  const suggested = (kataSuggestions || []).filter((s) => !known.has(s.builtinId));
  const suggestedIds = new Set(suggested.map((s) => s.builtinId));
  const library = KATA_LIBRARY.filter((k) => !known.has(k.id) && !suggestedIds.has(k.id));

  const [error, setError] = useState(null); // App's banner sits behind the sheet
  const [noteOpen, setNoteOpen] = useState(null); // which kata's note is unfolded
  const [showRetired, setShowRetired] = useState(false);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const submitting = useRef(false); // blocks a double Enter from adding twice

  // every edit is a save(); a false result (cap 400s included — App's banner is
  // invisible under the overlay) surfaces in-sheet via the banner below
  const mutate = async (fn, failMsg) => {
    const ok = await save(fn);
    setError(ok ? null : failMsg);
    return ok;
  };

  const saveFail = "couldn't save that kata — try again";
  const adopt = (builtinId, adoptTitle) =>
    mutate((s) => {
      s.kata = [...(s.kata || []), newKata(s, { title: adoptTitle, builtinId })];
    }, saveFail);
  const retire = (id) =>
    mutate((s) => {
      const k = (s.kata || []).find((x) => x.id === id);
      if (k) {
        k.active = false;
      }
    }, "couldn't retire that kata — try again");
  const reactivate = (id) =>
    mutate((s) => {
      const k = (s.kata || []).find((x) => x.id === id);
      if (k) {
        k.active = true;
      }
    }, saveFail);
  // save() itself offers the undo toast from the PUT's trash receipt
  const remove = (id) =>
    mutate((s) => {
      s.kata = (s.kata || []).filter((x) => x.id !== id);
    }, "couldn't delete that kata — try again");

  const addOwn = async (e) => {
    e.preventDefault();
    if (submitting.current || !title.trim()) {
      return;
    }
    submitting.current = true;
    const ok = await mutate((s) => {
      s.kata = [...(s.kata || []), newKata(s, { title: title.trim(), note: note.trim() || null })];
    }, saveFail);
    submitting.current = false;
    if (ok) {
      setTitle("");
      setNote("");
    }
  };

  return (
    <Modal title="道場 dōjō — the training hall" onClose={onClose}>
      <p className="-mt-3 text-xs text-slate-400">
        Small daily forms, practiced rather than completed. Honor every active kata and the day is
        clean.
      </p>

      <div>
        <SectionHead right={active.length ? `${active.length} active` : null}>
          your kata
        </SectionHead>
        {active.length === 0 ? (
          <p className="mt-1.5 px-1 text-sm text-slate-400">
            none yet — adopt a form below, or write your own.
          </p>
        ) : (
          <ul className="mt-1 divide-y divide-slate-100 dark:divide-slate-800">
            {active.map((k) => (
              <li key={k.id} className="flex items-start gap-2.5 py-2">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-sm font-medium text-slate-800 dark:text-slate-100">
                    <span className="truncate">{k.title}</span>
                    {k.note ? (
                      <button
                        onClick={() => setNoteOpen((v) => (v === k.id ? null : k.id))}
                        aria-label={noteOpen === k.id ? "Hide note" : "Show note"}
                        aria-expanded={noteOpen === k.id}
                        className="inline-flex shrink-0 items-center p-0.5 text-iris-500 transition hover:text-iris-600 dark:text-iris-300 dark:hover:text-iris-200"
                      >
                        <StickyNote size={12} />
                      </button>
                    ) : null}
                  </p>
                  {k.builtinId && hintOf.get(k.builtinId) ? (
                    <p className="text-xs text-slate-400">{hintOf.get(k.builtinId)}</p>
                  ) : null}
                  {k.note && noteOpen === k.id ? (
                    <p className="mt-1 whitespace-pre-wrap rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                      {k.note}
                    </p>
                  ) : null}
                </div>
                {/* one tap — retiring is reversible from the pile below */}
                <button
                  onClick={() => retire(k.id)}
                  disabled={busy}
                  aria-label={`Retire ${k.title}`}
                  className="shrink-0 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                >
                  retire
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {suggested.length ? (
        <div>
          <SectionHead>suggested</SectionHead>
          <ul className="mt-1 divide-y divide-slate-100 dark:divide-slate-800">
            {suggested.map((s) => (
              <li key={s.builtinId} className="flex items-center gap-2.5 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
                    {s.title}
                  </p>
                  <p className="flex items-start gap-1 text-xs text-trail-700 dark:text-trail-400">
                    <Sparkles size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
                    {s.reason}
                  </p>
                </div>
                <Button
                  variant="subtle"
                  disabled={busy}
                  onClick={() => adopt(s.builtinId, s.title)}
                  aria-label={`Adopt kata: ${s.title}`}
                  className="shrink-0 !py-1.5 text-xs"
                >
                  adopt
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {library.length ? (
        <div>
          <SectionHead>the library</SectionHead>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {library.map((k) => (
              <button
                key={k.id}
                disabled={busy}
                title={k.hint}
                onClick={() => adopt(k.id, k.title)}
                aria-label={`Adopt kata: ${k.title} — ${k.hint}`}
                className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-500 transition hover:border-trail-400 hover:text-trail-700 disabled:opacity-40 dark:border-slate-600 dark:text-slate-400 dark:hover:border-trail-500 dark:hover:text-trail-400"
              >
                <Plus size={12} aria-hidden="true" />
                {k.title}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div>
        <SectionHead>your own</SectionHead>
        <form onSubmit={addOwn} className="mt-1.5 space-y-2">
          <div className="flex gap-2">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="a form of your own… e.g. “inbox zero by nine”"
              aria-label="New kata"
            />
            <Button type="submit" disabled={busy || !title.trim()} aria-label="Add kata">
              <Plus size={16} />
            </Button>
          </div>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="note (optional)"
            aria-label="Kata note"
          />
        </form>
      </div>

      {retired.length ? (
        <div>
          <button
            onClick={() => setShowRetired((v) => !v)}
            aria-expanded={showRetired}
            className="flex items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-slate-400"
          >
            {showRetired ? <ChevronDown size={14} /> : <ChevronRight size={14} />} retired ·{" "}
            {retired.length}
          </button>
          {showRetired ? (
            <ul className="mt-1 divide-y divide-slate-100 dark:divide-slate-800">
              {retired.map((k) => (
                <li key={k.id} className="flex items-center gap-2.5 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-500 dark:text-slate-400">
                    {k.title}
                  </span>
                  <button
                    onClick={() => reactivate(k.id)}
                    disabled={busy}
                    aria-label={`Re-activate ${k.title}`}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-trail-700 transition hover:bg-trail-50 disabled:opacity-40 dark:text-trail-400 dark:hover:bg-slate-800"
                  >
                    <Undo2 size={13} /> re-activate
                  </button>
                  <ConfirmButton
                    label={`Delete ${k.title} forever`}
                    onConfirm={() => remove(k.id)}
                    className="h-8 min-w-8 shrink-0"
                  >
                    <Trash2 size={14} />
                  </ConfirmButton>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600 dark:bg-rose-950/40"
        >
          {error}
        </p>
      ) : null}
    </Modal>
  );
}
