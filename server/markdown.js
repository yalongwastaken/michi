// markdown.js — Markdown export/sync. renderExport() turns the whole model into a
// Claude-ready document (an instruction header + the snapshot); parseSync/planSync/
// applySync take a pasted reply back in. Sync is create + update ONLY — it never
// deletes or archives anything, and it never writes completion-log rows: streak and
// heatmap history stay owned by in-app check-offs (db.setDone).
//
// Grammar (one item per line). On a line WITH an `{#id}` anchor the title is
// everything before the anchor and attribute tokens are read only after it; on a
// line WITHOUT one, tokens are scanned from the right end — see the parse section.
// A `> ` blockquote line directly under a step/task attaches to it as notes.
//   ## Roadmap: <title> {#id}
//   archived · target: YYYY-MM-DD · 40% done        ← meta, only fields with values
//   ### Milestone: <title> {#id}
//   - [x] <step title> {#id} ~30m https://resource
//     > <notes, one `> ` line per notes line>
//   ## Project: <title> {#id}
//   status: idea|active|shipped · repo: <url> · roadmap:#<id>
//   <summary line, when present>
//   ## Tasks
//   - [ ] <title> {#id} due:YYYY-MM-DD ~30m step:#<id> project:#<id> every:daily
//     > <notes, same shape as steps>
import { getFullState, validateState, importAll } from "./db.js";

const RECURRENCE = new Set(["daily", "weekdays", "weekly"]);
const PROJECT_STATUS = new Set(["idea", "active", "shipped"]);
const MARK_TO_STATUS = { " ": "todo", "~": "doing", x: "done", X: "done" };
const STATUS_TO_MARK = { todo: " ", doing: "~", done: "x" };
const COLLECTIONS = ["roadmaps", "milestones", "steps", "projects", "tasks"];

/** Strict calendar-day check — mirrors db.js's isValidDay (not exported there). */
function isValidDay(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return false;
  }
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// ids: same shape the client mints (client/src/lib/uid.js) — the server has no
// shared uid helper, so sync carries its own copy, prefixes included.
function uid(prefix = "") {
  const rnd =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return prefix ? `${prefix}_${rnd.slice(0, 8)}` : rnd;
}

// titles are single-line in the grammar — fold newlines away and defuse `{#…}`
// so a title can't smuggle a fake anchor into the document
function cleanTitle(t) {
  return String(t ?? "")
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\{#/g, "{ #")
    .trim();
}

const anchor = (id) => `{#${id}}`;

// notes render as a blockquote right under their item, one `> ` line per notes
// line, indented so the quote reads as part of the list item (an empty notes
// line becomes a bare `>` — no trailing whitespace to get trimmed in transit)
function pushNotes(L, notes) {
  if (!notes) {
    return;
  }
  for (const line of String(notes).split("\n")) {
    L.push(line ? `  > ${line}` : "  >");
  }
}

// cap the warning list so a 2000-line paste of the wrong file doesn't echo 2000
// warnings back — after the cap, just count
const MAX_WARNINGS = 10;
function warnCollector(list) {
  let extra = 0;
  return {
    warn(msg) {
      if (list.length < MAX_WARNINGS) {
        list.push(msg);
      } else {
        extra++;
      }
    },
    flush() {
      if (extra > 0) {
        list.push(`…and ${extra} more warning${extra === 1 ? "" : "s"}`);
      }
    },
  };
}

// ── export ──────────────────────────────────────────────────────────────────────
/**
 * Render the full model as a Markdown document: a prompt header telling Claude how
 * to reply in a syncable format, then `---`, then the snapshot itself.
 * @param {Object} state full model (getFullState-shaped; completions unused here)
 * @param {string} today local YYYY-MM-DD
 */
export function renderExport(state, today) {
  const s = state.settings || {};
  const L = [];

  L.push(
    "You are helping inside **michi**, a personal learning coach. The snapshot",
    "below is the user's full state: roadmaps (long-running learning tracks)",
    "contain milestones, milestones contain steps; projects are things being",
    "built and shipped; tasks are the daily layer, optionally linked to a step",
    "and/or a project.",
    "",
    `Today is ${today}. The user's daily goal is ${s.dailyGoal ?? 3} completions and the`,
    `daily time budget is ${s.dailyMinutes ?? 60} minutes — propose realistic daily plans`,
    "that fit that budget.",
    "",
    "Reply format — follow exactly:",
    "",
    "- Reply with ONE fenced markdown block in the same format as this snapshot.",
    "- Keep the `{#id}` anchor on any item you are editing. OMIT the anchor for",
    "  new items. Never invent ids.",
    "- Only include items you create or change — unchanged items may be left out.",
    "- Statuses: `[ ]` = todo, `[~]` = doing, `[x]` = done.",
    "- Dates: `due:YYYY-MM-DD`. Estimates: `~30m` (minutes, a positive integer).",
    "- Task links: `step:#<id>` / `project:#<id>`. Recurrence: `every:daily`,",
    "  `every:weekdays` or `every:weekly`. Project → roadmap link: `roadmap:#<id>`",
    "  on the project's meta line.",
    "- Put attribute tokens at the END of the line — after the `{#id}` anchor when",
    "  there is one, after the title otherwise.",
    "- Notes: attach a `> note` line directly under a step or task to annotate it",
    "  (several `> ` lines in a row make a multi-line note).",
    "- Deletions are not possible via sync — never remove or archive anything.",
    "",
    "---",
    "",
    `# michi snapshot · ${today}`,
    "",
  );

  const milestones = state.milestones || [];
  const steps = state.steps || [];
  for (const r of state.roadmaps || []) {
    L.push(`## Roadmap: ${cleanTitle(r.title)} ${anchor(r.id)}`);
    const mss = milestones.filter((m) => m.roadmapId === r.id);
    const msIds = new Set(mss.map((m) => m.id));
    const rSteps = steps.filter((st) => msIds.has(st.milestoneId));
    const meta = [];
    if (r.archived) {
      meta.push("archived");
    }
    if (r.targetDate) {
      meta.push(`target: ${r.targetDate}`);
    }
    if (!r.archived && rSteps.length > 0) {
      const done = rSteps.filter((st) => st.status === "done").length;
      meta.push(`${Math.round((100 * done) / rSteps.length)}% done`);
    }
    if (meta.length > 0) {
      L.push(meta.join(" · "));
    }
    if (!r.archived) {
      // archived roadmaps keep their heading (so Claude knows they exist) but the
      // tree is noise for planning — omit it
      for (const m of mss) {
        L.push(`### Milestone: ${cleanTitle(m.title)} ${anchor(m.id)}`);
        for (const st of steps.filter((x) => x.milestoneId === m.id)) {
          const parts = [
            `- [${STATUS_TO_MARK[st.status] || " "}]`,
            cleanTitle(st.title),
            anchor(st.id),
          ];
          if (r.stepMinutes) {
            parts.push(`~${r.stepMinutes}m`); // roadmap-level estimate, informational
          }
          if (st.resourceUrl) {
            parts.push(st.resourceUrl);
          }
          L.push(parts.join(" "));
          pushNotes(L, st.notes);
        }
      }
    }
    L.push("");
  }

  for (const p of state.projects || []) {
    L.push(`## Project: ${cleanTitle(p.title)} ${anchor(p.id)}`);
    const meta = [];
    if (p.status) {
      meta.push(`status: ${p.status}`);
    }
    if (p.repoUrl) {
      meta.push(`repo: ${p.repoUrl}`);
    }
    if (p.roadmapId) {
      meta.push(`roadmap:#${p.roadmapId}`);
    }
    if (meta.length > 0) {
      L.push(meta.join(" · "));
    }
    if (p.summary) {
      L.push(cleanTitle(p.summary));
    }
    L.push("");
  }

  // always emit the heading, even when empty — it's where Claude adds new tasks
  L.push("## Tasks");
  for (const t of state.tasks || []) {
    const parts = [`- [${STATUS_TO_MARK[t.status] || " "}]`, cleanTitle(t.title), anchor(t.id)];
    if (t.due) {
      parts.push(`due:${t.due}`);
    }
    if (t.estMin) {
      parts.push(`~${t.estMin}m`);
    }
    if (t.stepId) {
      parts.push(`step:#${t.stepId}`);
    }
    if (t.projectId) {
      parts.push(`project:#${t.projectId}`);
    }
    if (t.recurrence) {
      parts.push(`every:${t.recurrence}`);
    }
    L.push(parts.join(" "));
    pushNotes(L, t.notes);
  }
  L.push("");

  return L.join("\n");
}

// ── parse ───────────────────────────────────────────────────────────────────────
// Two-mode grammar for any line that can carry an `{#id}` anchor:
//  - anchored (`<title> {#id} <tokens…>` — the exact shape renderExport emits):
//    everything BEFORE the anchor is the title, verbatim; attribute tokens are
//    read only from the tail. Round-tripping an export is exact by construction —
//    a title like "read ~30m of clock docs" can't lose words to the tokenizer.
//  - anchor-less (a new item): tokens are scanned from the RIGHT end of the line,
//    stopping at the first word that isn't a recognized token; the rest is the
//    title. Mid-title tokens survive ("read ~30m of clock docs" stays whole).
//    Residual edge: a new title ENDING in a token-like word ("check every:daily")
//    loses its tail to the tokenizer — accepted, it only affects brand-new items.

const normalizeTitle = (s) => s.replace(/\s+/g, " ").trim();
const splitWords = (s) => s.split(/\s+/).filter(Boolean);

/** Split a fragment at its first `{#id}` anchor: title before, token tail after. */
function splitAnchor(text) {
  const m = text.match(/\{#([^}\s]+)\}/);
  if (!m) {
    return { id: null, title: normalizeTitle(text), tail: null };
  }
  return {
    id: m[1],
    title: normalizeTitle(text.slice(0, m.index)),
    tail: text.slice(m.index + m[0].length),
  };
}

// a word is a token when its whole shape matches; the value is validated on
// apply, so a malformed value ("due:2026-99-99") is still consumed — with a
// warning — instead of leaking into the title
const TASK_TOKENS = [
  [
    /^due:(\S+)$/,
    (item, v, warn) => {
      if (isValidDay(v)) {
        item.due = v;
      } else {
        warn(`invalid due date "${v}" ignored`);
      }
    },
  ],
  [
    /^~(\d+)m$/,
    (item, v, warn) => {
      const n = Number(v);
      if (n > 0) {
        item.estMin = n;
      } else {
        warn(`invalid estimate "~${v}m" ignored`);
      }
    },
  ],
  [
    /^step:#([^\s}]+)$/,
    (item, v) => {
      item.stepRef = v;
    },
  ],
  [
    /^project:#([^\s}]+)$/,
    (item, v) => {
      item.projectRef = v;
    },
  ],
  [
    /^every:(\S+)$/,
    (item, v, warn) => {
      if (RECURRENCE.has(v)) {
        item.recurrence = v;
      } else {
        warn(`invalid recurrence "every:${v}" ignored`);
      }
    },
  ],
];
const STEP_TOKENS = [
  [/^~(\d+)m$/, () => {}], // roadmap-level display estimate — not a step field
  [
    /^(https?:\/\/\S+)$/,
    (item, v) => {
      item.resourceUrl = v;
    },
  ],
];

/** Anchored mode: consume every recognized token in the tail; return the leftovers. */
function takeTokens(tail, tokens, item, warn) {
  const leftover = [];
  for (const w of splitWords(tail)) {
    const spec = tokens.find(([re]) => re.test(w));
    if (spec) {
      spec[1](item, w.match(spec[0])[1], warn);
    } else {
      leftover.push(w);
    }
  }
  return leftover;
}

/** Anchor-less mode: scan words from the right, stop at the first non-token. */
function scanTokens(body, tokens, item, warn) {
  const ws = splitWords(body);
  let cut = ws.length;
  while (cut > 0 && tokens.some(([re]) => re.test(ws[cut - 1]))) {
    cut--;
  }
  for (const w of ws.slice(cut)) {
    const spec = tokens.find(([re]) => re.test(w));
    spec[1](item, w.match(spec[0])[1], warn);
  }
  return ws.slice(0, cut).join(" "); // the title
}

/**
 * Tolerant parse of a pasted reply (or a whole export pasted back). Returns doc-order
 * item lists with parent linkage by index; unknown lines become warnings, never errors.
 * Field presence matters downstream: a field absent from the line stays undefined,
 * and planSync only compares/changes fields that are present.
 */
export function parseSync(markdown) {
  const warnings = [];
  const { warn, flush } = warnCollector(warnings);
  const out = { roadmaps: [], milestones: [], steps: [], projects: [], tasks: [], warnings };

  let lines = String(markdown ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((l) => !/^\s*```/.test(l)); // unwrap a fenced reply
  // a full export pasted back carries the prompt header — skip to the snapshot
  const snap = lines.findIndex((l) => /^#\s*michi snapshot/i.test(l.trim()));
  if (snap >= 0) {
    lines = lines.slice(snap + 1);
  }

  // parser context: which heading we're under decides where list items attach;
  // `note` is the step/task the NEXT blockquote line would annotate
  const cur = { section: null, roadmap: null, milestone: null, project: null, note: null };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || /^-{3,}$/.test(line) || /^#\s/.test(line)) {
      cur.note = null; // the list broke off — a later blockquote is an orphan
      continue; // blanks, ---, and h1s carry no data
    }

    // `> ` lines directly under a step/task attach to it as notes (consecutive
    // quote lines join with \n); a blockquote anywhere else is just skipped
    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      if (cur.note) {
        cur.note.notes = cur.note.notes === undefined ? quote[1] : `${cur.note.notes}\n${quote[1]}`;
      } else {
        warn(`skipped line: "${line.slice(0, 60)}"`);
      }
      continue;
    }
    cur.note = null; // any other line ends the attachment window (list items reopen it)

    // headings carry a title and (optionally) an anchor, nothing else — any text
    // after the anchor is dropped with a warning, never parsed as meta
    const heading = (fragment) => {
      const { id, title, tail } = splitAnchor(fragment);
      if (tail && tail.trim()) {
        warn(`text after anchor ignored: "${tail.trim().slice(0, 40)}"`);
      }
      return { id, title };
    };

    let m;
    if ((m = line.match(/^##\s+Roadmap:\s*(.+)$/i))) {
      out.roadmaps.push(heading(m[1]));
      Object.assign(cur, { section: "roadmap", roadmap: out.roadmaps.length - 1, milestone: null });
      continue;
    }
    if ((m = line.match(/^###\s+Milestone:\s*(.+)$/i))) {
      if (cur.roadmap == null) {
        // no roadmap context (start of doc, or after a Project/Tasks heading) —
        // skip the milestone AND leave no context, so its steps warn too
        warn(`milestone outside a roadmap skipped: "${line.slice(0, 60)}"`);
        Object.assign(cur, { section: null, milestone: null });
        continue;
      }
      out.milestones.push({ ...heading(m[1]), roadmapIndex: cur.roadmap });
      cur.milestone = out.milestones.length - 1;
      continue;
    }
    if ((m = line.match(/^##\s+Project:\s*(.+)$/i))) {
      out.projects.push(heading(m[1]));
      Object.assign(cur, {
        section: "project",
        project: out.projects.length - 1,
        roadmap: null,
        milestone: null,
      });
      continue;
    }
    if (/^##\s+Tasks\s*$/i.test(line)) {
      Object.assign(cur, { section: "tasks", roadmap: null, milestone: null });
      continue;
    }

    if ((m = line.match(/^[-*]\s*\[([ xX~])\]\s*(.+)$/))) {
      const status = MARK_TO_STATUS[m[1]];
      const { id, title, tail } = splitAnchor(m[2]);
      // anchored → verbatim title, tokens from the tail only; anchor-less →
      // right-scan the whole body (see the grammar note above)
      const fill = (item, tokens) => {
        if (tail !== null) {
          item.title = title;
          const leftover = takeTokens(tail, tokens, item, warn);
          if (leftover.length > 0) {
            warn(`text after anchor ignored: "${leftover.join(" ").slice(0, 40)}"`);
          }
        } else {
          item.title = scanTokens(m[2], tokens, item, warn);
        }
      };
      if (cur.section === "tasks") {
        const item = { id, status };
        fill(item, TASK_TOKENS);
        if (!item.title) {
          warn("task with an empty title skipped");
          continue;
        }
        out.tasks.push(item);
        cur.note = item; // a following blockquote annotates this task
      } else if (cur.milestone != null) {
        const item = { id, status, milestoneIndex: cur.milestone };
        fill(item, STEP_TOKENS);
        if (!item.title) {
          warn("step with an empty title skipped");
          continue;
        }
        out.steps.push(item);
        cur.note = item; // a following blockquote annotates this step
      } else {
        warn(`list item outside a milestone or Tasks section skipped: "${line.slice(0, 60)}"`);
      }
      continue;
    }

    // not a heading, not a list item — a meta line for the current section, maybe
    if (cur.section === "roadmap" && cur.milestone == null) {
      const parts = line.split(/\s*·\s*/);
      const known = (p) =>
        /^archived$/i.test(p) || /^target:\s*\S+$/.test(p) || /^\d+%\s*done$/.test(p);
      if (parts.every(known)) {
        for (const p of parts) {
          const t = p.match(/^target:\s*(\S+)$/);
          if (t && isValidDay(t[1])) {
            out.roadmaps[cur.roadmap].targetDate = t[1];
          } else if (t) {
            warn(`invalid target date "${t[1]}" ignored`);
          }
          // `archived` and `NN% done` are display-only: sync never archives, and
          // progress is derived from step statuses
        }
        continue;
      }
    }
    if (cur.section === "project") {
      const parts = line.split(/\s*·\s*/);
      const known = (p) =>
        /^status:\s*\S+$/.test(p) || /^repo:\s*\S+$/.test(p) || /^roadmap:#\S+$/.test(p);
      if (parts.every(known)) {
        for (const p of parts) {
          let t;
          if ((t = p.match(/^status:\s*(\S+)$/))) {
            if (PROJECT_STATUS.has(t[1])) {
              out.projects[cur.project].status = t[1];
            } else {
              warn(`invalid project status "${t[1]}" ignored`);
            }
          } else if ((t = p.match(/^repo:\s*(\S+)$/))) {
            out.projects[cur.project].repoUrl = t[1];
          } else if ((t = p.match(/^roadmap:#([^\s}]+)$/))) {
            out.projects[cur.project].roadmapRef = t[1];
          }
        }
        continue;
      }
      // any other plain line under a project heading is its summary
      if (out.projects[cur.project].summary === undefined) {
        out.projects[cur.project].summary = line;
        continue;
      }
    }
    warn(`skipped line: "${line.slice(0, 60)}"`);
  }

  flush();
  return out;
}

// ── plan ────────────────────────────────────────────────────────────────────────
// compare only the fields the MD line actually carried (undefined = "not present");
// normalize null/undefined so an absent column and a missing token compare equal
function diffFields(existing, fields) {
  const changes = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) {
      continue;
    }
    const from = existing[k] ?? null;
    const to = v ?? null;
    if (from !== to) {
      changes[k] = { from, to };
    }
  }
  return changes;
}

// status is always present on a list item; a transition to done stamps doneAt,
// leaving done clears it. NOTE: sync never writes completion-log rows — streak and
// heatmap history stay owned by in-app check-offs (db.setDone).
function applyStatusChange(existing, status, changes, now) {
  if (existing.status === status) {
    return;
  }
  changes.status = { from: existing.status, to: status };
  if (status === "done") {
    changes.doneAt = { from: existing.doneAt ?? null, to: now };
  } else if (existing.status === "done") {
    changes.doneAt = { from: existing.doneAt ?? null, to: null };
  }
}

// new items land after their siblings: max(position)+1, counting siblings already
// created earlier in this same document
function nextPosition(stateItems, createdItems, inGroup = () => true) {
  let max = -1;
  for (const list of [stateItems, createdItems]) {
    for (const it of list || []) {
      if (inGroup(it) && Number(it.position) > max) {
        max = Number(it.position);
      }
    }
  }
  return max + 1;
}

/**
 * Turn a parsed document into a concrete plan against the current state: prepared
 * create rows and per-field update diffs. Pure — nothing is written here. Existing
 * items keep their position; sync never deletes or archives.
 * @returns {{creates: Object, updates: Array, warnings: string[]}}
 */
export function planSync(parsed, state) {
  const warnings = [];
  const { warn, flush } = warnCollector(warnings);
  const now = new Date().toISOString();
  const creates = { roadmaps: [], milestones: [], steps: [], projects: [], tasks: [] };
  const byId = {
    roadmap: new Map((state.roadmaps || []).map((x) => [x.id, x])),
    milestone: new Map((state.milestones || []).map((x) => [x.id, x])),
    step: new Map((state.steps || []).map((x) => [x.id, x])),
    project: new Map((state.projects || []).map((x) => [x.id, x])),
    task: new Map((state.tasks || []).map((x) => [x.id, x])),
  };
  // unknown doc anchors become fresh ids, but same-doc references (a task's
  // step:#/project:# pointing at an item created above) must still resolve
  const remap = new Map();

  // duplicate `{#id}` anchors in one doc are MERGED: later fields overlay earlier
  // ones per-field and the diff is recomputed from the merged view, so preview and
  // apply agree (apply used to silently last-win via a Map keyed on kind:id)
  const accum = new Map(); // `${kind}:${id}` → the fields the doc has carried so far
  const updateByKey = new Map(); // `${kind}:${id}` → update row, in first-seen order
  const recordUpdate = (kind, existing, title, fields, status, extend) => {
    const key = `${kind}:${existing.id}`;
    let acc = accum.get(key);
    if (acc) {
      warn(`duplicate anchor {#${existing.id}} — lines merged`);
      for (const [k, v] of Object.entries(fields)) {
        if (v !== undefined) {
          acc.fields[k] = v;
        }
      }
      if (status !== undefined) {
        acc.status = status;
      }
    } else {
      acc = { fields: { ...fields }, status };
      accum.set(key, acc);
    }
    const changes = diffFields(existing, acc.fields);
    if (acc.status !== undefined) {
      applyStatusChange(existing, acc.status, changes, now);
    }
    extend?.(changes);
    const row = updateByKey.get(key);
    if (row) {
      Object.assign(row, { title, changes });
    } else {
      updateByKey.set(key, { kind, id: existing.id, title, changes });
    }
  };
  // an anchor that matches nothing is Claude inventing (or typo-ing) an id — keep
  // the item, but as a create under a fresh id
  const demote = (kind, docId, title, freshId) => {
    warn(`unknown id "${docId}" on ${kind} "${title}" — treated as new`);
    remap.set(docId, freshId);
  };
  // anchor-less lines are usually Claude giving context — or a careless re-paste of
  // an earlier reply — not creating. Try an exact (case-insensitive) title match
  // first, so `## Roadmap: Embedded` without an anchor references the real roadmap
  // instead of spawning a duplicate that anchored children would then be re-parented
  // under. The same applies to list items: steps match among the steps of their
  // resolved milestone, tasks across all tasks — so re-applying the same reply
  // updates the items it created the first time instead of duplicating them.
  const matchByTitle = (kind, list, title, inGroup = () => true) => {
    const t = title.toLowerCase();
    const hits = (list || []).filter(
      (x) => inGroup(x) && String(x.title).trim().toLowerCase() === t,
    );
    if (hits.length === 1) {
      warn(`${kind} without an anchor matched "${hits[0].title}" by title`);
      return hits[0];
    }
    if (hits.length > 1) {
      warn(`${hits.length} ${kind}s titled "${title}" — created a new one`);
    }
    return null;
  };
  // …and when an anchor-less line matched nothing in the state but an EARLIER line
  // of this same doc already created the item, merge into that pending create row
  // (later fields overlay, mirroring the duplicate-anchor merge) instead of
  // creating N copies of one title
  const mergeIntoCreate = (kind, list, title, inGroup, overlay) => {
    const t = title.toLowerCase();
    const dup = list.find((x) => inGroup(x) && String(x.title).trim().toLowerCase() === t);
    if (dup) {
      warn(`duplicate ${kind} "${title}" — lines merged`);
      overlay(dup);
    }
    return dup;
  };

  const roadmapIds = [];
  for (const r of parsed.roadmaps || []) {
    const existing = r.id
      ? byId.roadmap.get(r.id)
      : matchByTitle("roadmap", state.roadmaps, r.title);
    if (existing) {
      roadmapIds.push(existing.id);
      recordUpdate("roadmap", existing, r.title, { title: r.title, targetDate: r.targetDate });
      continue;
    }
    const id = uid("rm");
    if (r.id) {
      demote("roadmap", r.id, r.title, id);
    }
    roadmapIds.push(id);
    creates.roadmaps.push({
      id,
      title: r.title,
      sourceUrl: null,
      color: null,
      archived: false,
      position: nextPosition(state.roadmaps, creates.roadmaps),
      createdAt: now,
      targetDate: r.targetDate ?? null,
      stepMinutes: null,
    });
  }

  const milestoneIds = [];
  for (const m of parsed.milestones || []) {
    const parentId = roadmapIds[m.roadmapIndex];
    const existing = m.id
      ? byId.milestone.get(m.id)
      : matchByTitle("milestone", state.milestones, m.title, (x) => x.roadmapId === parentId);
    if (existing) {
      milestoneIds.push(existing.id);
      const fields = { title: m.title };
      if (parentId && existing.roadmapId !== parentId) {
        warn(`milestone "${m.title}" moved under a different roadmap`);
        fields.roadmapId = parentId;
      }
      recordUpdate("milestone", existing, m.title, fields);
      continue;
    }
    const id = uid("ms");
    if (m.id) {
      demote("milestone", m.id, m.title, id);
    }
    milestoneIds.push(id);
    creates.milestones.push({
      id,
      roadmapId: parentId,
      title: m.title,
      position: nextPosition(state.milestones, creates.milestones, (x) => x.roadmapId === parentId),
    });
  }

  for (const st of parsed.steps || []) {
    const parentId = milestoneIds[st.milestoneIndex];
    const existing = st.id
      ? byId.step.get(st.id)
      : matchByTitle("step", state.steps, st.title, (x) => x.milestoneId === parentId);
    if (existing) {
      const fields = { title: st.title, resourceUrl: st.resourceUrl, notes: st.notes };
      if (parentId && existing.milestoneId !== parentId) {
        warn(`step "${st.title}" moved under a different milestone`);
        fields.milestoneId = parentId;
      }
      recordUpdate("step", existing, st.title, fields, st.status);
      continue;
    }
    if (
      !st.id &&
      mergeIntoCreate(
        "step",
        creates.steps,
        st.title,
        (x) => x.milestoneId === parentId,
        (row) => {
          row.status = st.status;
          row.doneAt = st.status === "done" ? now : null;
          if (st.resourceUrl !== undefined) {
            row.resourceUrl = st.resourceUrl;
          }
          if (st.notes !== undefined) {
            row.notes = st.notes;
          }
        },
      )
    ) {
      continue;
    }
    const id = uid("step");
    if (st.id) {
      demote("step", st.id, st.title, id);
    }
    creates.steps.push({
      id,
      milestoneId: parentId,
      title: st.title,
      status: st.status,
      position: nextPosition(state.steps, creates.steps, (x) => x.milestoneId === parentId),
      resourceUrl: st.resourceUrl ?? null,
      notes: st.notes ?? null,
      doneAt: st.status === "done" ? now : null,
    });
  }

  // a dangling ref would fail validateState deep in apply — drop it with a warning
  const resolveRef = (ref, kind, ownerKind, title) => {
    if (ref === undefined) {
      return undefined;
    }
    if (remap.has(ref)) {
      return remap.get(ref);
    }
    if (byId[kind].has(ref)) {
      return ref;
    }
    warn(`${ownerKind} "${title}" references unknown ${kind} "#${ref}" — link dropped`);
    return undefined;
  };

  for (const p of parsed.projects || []) {
    const roadmapId = resolveRef(p.roadmapRef, "roadmap", "project", p.title);
    const existing = p.id
      ? byId.project.get(p.id)
      : matchByTitle("project", state.projects, p.title);
    if (existing) {
      const fields = {
        title: p.title,
        status: p.status,
        repoUrl: p.repoUrl,
        summary: p.summary,
        roadmapId,
      };
      recordUpdate("project", existing, p.title, fields, undefined, (changes) => {
        if (changes.status) {
          // keep shippedAt in step with the status, the way the client does
          if (changes.status.to === "shipped") {
            changes.shippedAt = { from: existing.shippedAt ?? null, to: now };
          } else if (existing.status === "shipped") {
            changes.shippedAt = { from: existing.shippedAt ?? null, to: null };
          }
        }
      });
      continue;
    }
    const id = uid("proj");
    if (p.id) {
      demote("project", p.id, p.title, id);
    }
    creates.projects.push({
      id,
      title: p.title,
      status: p.status ?? "idea",
      repoUrl: p.repoUrl ?? null,
      summary: p.summary ?? null,
      position: nextPosition(state.projects, creates.projects),
      createdAt: now,
      shippedAt: p.status === "shipped" ? now : null,
      roadmapId: roadmapId ?? null,
    });
  }

  for (const t of parsed.tasks || []) {
    const stepId = resolveRef(t.stepRef, "step", "task", t.title);
    const projectId = resolveRef(t.projectRef, "project", "task", t.title);
    const existing = t.id ? byId.task.get(t.id) : matchByTitle("task", state.tasks, t.title);
    if (existing) {
      recordUpdate(
        "task",
        existing,
        t.title,
        {
          title: t.title,
          due: t.due,
          estMin: t.estMin,
          recurrence: t.recurrence,
          stepId,
          projectId,
          notes: t.notes,
        },
        t.status,
      );
      continue;
    }
    if (
      !t.id &&
      mergeIntoCreate(
        "task",
        creates.tasks,
        t.title,
        () => true,
        (row) => {
          row.status = t.status;
          row.doneAt = t.status === "done" ? now : null;
          if (t.due !== undefined) {
            row.due = t.due;
          }
          if (t.estMin !== undefined) {
            row.estMin = t.estMin;
          }
          if (t.recurrence !== undefined) {
            row.recurrence = t.recurrence;
          }
          if (stepId !== undefined) {
            row.stepId = stepId;
          }
          if (projectId !== undefined) {
            row.projectId = projectId;
          }
          if (t.notes !== undefined) {
            row.notes = t.notes;
          }
        },
      )
    ) {
      continue;
    }
    const id = uid("task");
    if (t.id) {
      demote("task", t.id, t.title, id);
    }
    creates.tasks.push({
      id,
      title: t.title,
      status: t.status,
      due: t.due ?? null,
      recurrence: t.recurrence ?? null,
      stepId: stepId ?? null,
      projectId: projectId ?? null,
      estMin: t.estMin ?? null,
      position: nextPosition(state.tasks, creates.tasks),
      notes: t.notes ?? null,
      createdAt: now,
      doneAt: t.status === "done" ? now : null,
    });
  }

  // a merged (or unchanged) line can leave a row with nothing to change — drop it
  const updates = [...updateByKey.values()].filter((u) => Object.keys(u.changes).length > 0);
  flush();
  return { creates, updates, warnings };
}

// ── apply ───────────────────────────────────────────────────────────────────────
/**
 * Merge a parsed document into the live state and persist it in one transaction
 * (importAll is atomic — a failure leaves everything untouched). The completions
 * log is passed through unchanged: sync never writes history.
 * @returns {{state: Object, applied: {createdCounts, updatedCounts}, warnings: string[]}}
 * @throws {Error} with a readable message when the merge would be invalid
 */
export function applySync(parsed) {
  const state = getFullState();
  const plan = planSync(parsed, state);

  const changeMap = new Map(plan.updates.map((u) => [`${u.kind}:${u.id}`, u.changes]));
  const applyTo = (kind, items, created) =>
    items
      .map((it) => {
        const ch = changeMap.get(`${kind}:${it.id}`);
        if (!ch) {
          return it;
        }
        const patch = {};
        for (const [k, c] of Object.entries(ch)) {
          patch[k] = c.to;
        }
        return { ...it, ...patch };
      })
      .concat(created);

  const merged = {
    roadmaps: applyTo("roadmap", state.roadmaps, plan.creates.roadmaps),
    milestones: applyTo("milestone", state.milestones, plan.creates.milestones),
    steps: applyTo("step", state.steps, plan.creates.steps),
    projects: applyTo("project", state.projects, plan.creates.projects),
    tasks: applyTo("task", state.tasks, plan.creates.tasks),
    profile: state.profile,
    settings: state.settings,
    completions: state.completions, // preserved as-is — sync never touches history
  };
  const bad = validateState(merged);
  if (bad) {
    throw new Error(`sync would produce an invalid state: ${bad}`);
  }

  const fresh = importAll(merged);
  const createdCounts = Object.fromEntries(
    Object.entries(plan.creates).map(([k, v]) => [k, v.length]),
  );
  const updatedCounts = Object.fromEntries(COLLECTIONS.map((k) => [k, 0]));
  for (const u of plan.updates) {
    updatedCounts[`${u.kind}s`]++;
  }
  return { state: fresh, applied: { createdCounts, updatedCounts }, warnings: plan.warnings };
}

/** Did the parse find anything syncable at all? (endpoints 400 when it didn't) */
export function hasParsedItems(parsed) {
  return COLLECTIONS.some((k) => (parsed[k] || []).length > 0);
}
