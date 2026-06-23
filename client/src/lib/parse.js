// parse.js — turn pasted Markdown (a roadmap.sh export, a GitHub roadmap README,
// course notes…) into a roadmap tree: { title, milestones:[{title, steps:[…]}] }.
// Pure + dependency-free so it runs in the browser (no outbound calls) and is easy
// to unit-test. Deliberately forgiving: it skips anything it doesn't understand.

/** Strip the common inline Markdown so titles read cleanly. */
function stripInline(s) {
  return s
    .replace(/`([^`]+)`/g, "$1") // `code`
    .replace(/\*\*([^*]+)\*\*/g, "$1") // **bold**
    .replace(/__([^_]+)__/g, "$1") // __bold__
    .replace(/\*([^*]+)\*/g, "$1") // *italic*
    .replace(/_([^_]+)_/g, "$1") // _italic_
    .trim();
}

/** Pull the first Markdown link out of a line → { text, url } (url null if none). */
function extractLink(s) {
  const m = s.match(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/);
  if (!m) {
    return { text: s, url: null };
  }
  // replace the link with its visible text, keep any surrounding words
  const text = s
    .replace(m[0], m[1])
    .replace(/\s{2,}/g, " ")
    .trim();
  return { text: text || m[1], url: m[2] };
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;
const CHECKBOX = /^\[([ xX])\]\s+(.*)$/;

/**
 * Parse Markdown into a roadmap tree.
 * - the first H1 (`#`) becomes the title (overridable via opts.title)
 * - `##`/`###`… headings become milestones
 * - list items become steps; `- [x]` marks a step done; `[text](url)` → resourceUrl
 * - list items before any heading land in an implicit "Steps" milestone
 * @returns {{title:string, milestones:Array<{title:string, steps:Array}>, stepCount:number}}
 */
export function parseRoadmap(md, opts = {}) {
  const lines = String(md || "").split(/\r?\n/);
  let title = opts.title ? String(opts.title).trim() : "";
  const milestones = [];
  let current = null;
  let inFence = false;

  const ensureMilestone = () => {
    if (!current) {
      current = { title: "Steps", steps: [] };
      milestones.push(current);
    }
    return current;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^\s*```/.test(line)) {
      inFence = !inFence; // ignore fenced code blocks entirely
      continue;
    }
    if (inFence || !line.trim()) {
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      const level = heading[1].length;
      const text = stripInline(heading[2]);
      if (level === 1 && !title) {
        title = text; // first H1 → the roadmap's name
      } else {
        current = { title: text, steps: [] };
        milestones.push(current);
      }
      continue;
    }

    const item = line.match(LIST_ITEM);
    if (item) {
      let body = item[1].trim();
      let status = "todo";
      const cb = body.match(CHECKBOX);
      if (cb) {
        status = cb[1].toLowerCase() === "x" ? "done" : "todo";
        body = cb[2].trim();
      }
      const { text, url } = extractLink(body);
      const clean = stripInline(text);
      if (clean) {
        ensureMilestone().steps.push({ title: clean, status, resourceUrl: url });
      }
    }
    // non-heading, non-list lines (prose) are ignored
  }

  // drop empty milestones so a stray heading doesn't create a hollow section
  const kept = milestones.filter((m) => m.steps.length > 0);
  const stepCount = kept.reduce((n, m) => n + m.steps.length, 0);
  return { title: title || "Imported roadmap", milestones: kept, stepCount };
}
