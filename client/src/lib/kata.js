// kata.js — mirror of server/kata.js's KATA_LIBRARY, so the dōjō sheet can render
// the full menu without a round-trip. The server stays the authority on what an
// adopted builtinId means — keep the two lists in sync by hand.
export const KATA_LIBRARY = [
  { id: "greyscale-phone", title: "greyscale phone", hint: "color is the hook — turn it off" },
  { id: "phone-away", title: "phone in another room", hint: "distance beats willpower" },
  { id: "no-feeds-am", title: "no feeds before noon", hint: "protect the morning mind" },
  { id: "dnd-deep", title: "DND during deep work", hint: "let the world wait an hour" },
  { id: "one-tab", title: "one-tab rule", hint: "one thing open, one thing done" },
  { id: "first-block", title: "25-minute first block", hint: "start before you're ready" },
  { id: "daylight", title: "morning daylight", hint: "light sets the clock" },
  { id: "desk-reset", title: "desk reset at day end", hint: "tomorrow-you finds a clear desk" },
  { id: "shutdown", title: "shutdown ritual", hint: "plan tomorrow, close the day" },
  { id: "water-first", title: "water before coffee", hint: "hydrate, then caffeinate" },
  { id: "read-10", title: "read 10 pages", hint: "small pages, big years" },
  { id: "lights-out", title: "lights out on time", hint: "the day ends where sleep begins" },
];

// mirror of server/db.js MAX_ACTIVE_KATA — a dōjō, not a checklist
export const MAX_ACTIVE_KATA = 5;
