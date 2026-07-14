// intensity.js — the abstract "how hard are you pushing" presets. Each level maps
// to the four concrete numbers the engine and planner actually read, so the rest of
// the app never has to know about intensity: choosing a level just writes these
// numbers (plus the `intensity` label) into settings. Picking a custom number in
// the advanced panel flips intensity to "custom".

// the numeric fields a preset owns — used to detect whether current settings still
// match a preset, and to write them all at once
export const INTENSITY_FIELDS = ["dailyGoal", "dailyMinutes", "weeklyActiveDays", "weeklyGoal"];

export const INTENSITY_LEVELS = [
  {
    id: "easy",
    label: "Easy",
    blurb: "gentle & sustainable",
    dailyGoal: 1,
    dailyMinutes: 30,
    weeklyActiveDays: 3,
    weeklyGoal: 5,
  },
  {
    id: "steady",
    label: "Steady",
    blurb: "a solid daily habit",
    dailyGoal: 3,
    dailyMinutes: 60,
    weeklyActiveDays: 5,
    weeklyGoal: 15,
  },
  {
    id: "focused",
    label: "Focused",
    blurb: "pushing forward",
    dailyGoal: 5,
    dailyMinutes: 90,
    weeklyActiveDays: 6,
    weeklyGoal: 28,
  },
  {
    id: "intense",
    label: "Intense",
    blurb: "all in",
    dailyGoal: 8,
    dailyMinutes: 150,
    weeklyActiveDays: 7,
    weeklyGoal: 50,
  },
];

const BY_ID = new Map(INTENSITY_LEVELS.map((lv) => [lv.id, lv]));

/** The preset for an id, or undefined. */
export function intensityLevel(id) {
  return BY_ID.get(id);
}

/** The patch that selecting a level writes into settings (numbers + the label). */
export function intensityPatch(id) {
  const lv = BY_ID.get(id);
  if (!lv) {
    return { intensity: id };
  }
  return {
    intensity: id,
    dailyGoal: lv.dailyGoal,
    dailyMinutes: lv.dailyMinutes,
    weeklyActiveDays: lv.weeklyActiveDays,
    weeklyGoal: lv.weeklyGoal,
  };
}

/**
 * Which level the current settings represent. A stored preset id wins; otherwise
 * we infer from the numbers (so old data, or an export edited by hand, still lands
 * on a named level); anything else is "custom".
 */
export function matchIntensity(settings = {}) {
  if (settings.intensity && BY_ID.has(settings.intensity)) {
    return settings.intensity;
  }
  const hit = INTENSITY_LEVELS.find((lv) =>
    INTENSITY_FIELDS.every((f) => settings[f] != null && Number(settings[f]) === lv[f]),
  );
  return hit?.id || "custom";
}
