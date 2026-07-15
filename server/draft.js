// draft.js — OPTIONAL: turn pasted raw content (a syllabus, an article, notes, a
// brain dump) into michi's sync markdown using the SAME local model as suggest.js.
// Nothing leaves the box — it's a localhost call to Ollama. The model only ever
// PRODUCES sync markdown for NEW items; that markdown then goes through the exact
// same parse → plan → preview → apply pipeline as a pasted Claude reply, so it's
// validated, previewed, and human-approved before anything is written (and sync can
// never delete). A small model getting a token slightly wrong is harmless: the user
// reviews and edits the draft before applying.
//
// Enable with the same switch as the planner: MICHI_LLM=1 (MICHI_LLM_MODEL / _URL).
import { aiConfig } from "./suggest.js";

const MODES = new Set(["roadmap", "tasks", "auto"]);
export const normalizeMode = (m) => (MODES.has(m) ? m : "auto");

// the creation subset of the sync grammar (see server/markdown.js) — no {#id}
// anchors (those are for editing existing items), just fresh roadmaps/steps/tasks
const GRAMMAR = [
  "michi's format — output ONE fenced ```markdown block and NOTHING else:",
  "- A learning track:",
  "  ## Roadmap: <title>",
  "  ### Milestone: <title>",
  "  - [ ] <step>            (one step per line; [ ] = to-do)",
  "- Standalone to-dos:",
  "  ## Tasks",
  "  - [ ] <task>            (optionally: due:YYYY-MM-DD, ~30m for minutes, every:daily)",
  "Rules: never write a {#id}; keep titles short and concrete; don't invent dates or",
  "estimates you weren't given; no commentary outside the block.",
];

/** Build the chat messages for a draft. Pure → unit-testable without a model. */
export function buildDraftMessages(text, mode, { today } = {}) {
  const m = normalizeMode(mode);
  const scope =
    m === "roadmap"
      ? "Organize it into ONE `## Roadmap:` with ordered milestones and steps (no `## Tasks`)."
      : m === "tasks"
        ? "Turn it into a `## Tasks` list of concrete to-dos (no `## Roadmap:`)."
        : "If it reads as a learning path, make a `## Roadmap:` with milestones and steps; " +
          "if it's a list of errands/to-dos, make a `## Tasks` list; use both only if clearly both.";
  const system = [
    "You convert a user's raw notes into a structured plan for michi, a personal",
    "learning-and-habit app. Extract the real, actionable items — don't pad, don't",
    "editorialize, don't drop things that matter.",
    today ? `Today is ${today}.` : "",
    scope,
    "",
    ...GRAMMAR,
  ]
    .filter(Boolean)
    .join("\n");
  const user = `Here is what I pasted:\n\n${text}`;
  return { system, user };
}

// pull the first fenced block's contents when the model wraps its answer (parseSync
// also tolerates fences, but stripping here keeps stray prose out of the draft)
function unfence(s) {
  const str = String(s || "");
  const m = str.match(/```(?:markdown|md)?\s*\n([\s\S]*?)```/i);
  return (m ? m[1] : str).trim();
}

/**
 * Ask the local model to draft sync markdown from `text`. Resolves to the markdown
 * string, or null on any failure (disabled config aside — the endpoint gates that;
 * here we simply can't reach/parse the model). Never throws.
 * @param deps injectable transport for tests ({ fetch })
 */
export async function draftStructured(text, mode = "auto", opts = {}, deps = {}) {
  const cfg = aiConfig();
  const doFetch = deps.fetch || globalThis.fetch;
  const { system, user } = buildDraftMessages(text, mode, { today: opts.today });

  let endpoint;
  try {
    endpoint = new URL("/api/chat", cfg.url).toString();
  } catch {
    return null; // a malformed MICHI_LLM_URL shouldn't 500 the request
  }

  try {
    const res = await doFetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: cfg.model,
        stream: false,
        options: { temperature: 0.3 },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(opts.timeoutMs || 45000),
    });
    if (!res.ok) {
      return null;
    }
    const data = await res.json();
    const md = unfence(data?.message?.content);
    return md || null;
  } catch {
    return null; // unreachable / timeout / bad JSON → caller reports "try again"
  }
}
