// CoachBubble.jsx — the companion says something. A mascot beside a small rounded
// speech bubble whose tail points at it. The bubble text is real text (screen
// readers get the words); the mascot stays decorative (aria-hidden inside Mascot).
// Restraint by convention: at most one talking mascot per screen, bubbles are
// static, and they never sit over an input.
import Mascot from "./Mascot.jsx";

const TAIL = "absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rotate-45 bg-white dark:bg-slate-900";
const EDGE = "border-slate-200/70 dark:border-slate-700/60";

/**
 * <CoachBubble species mood size side>one short line</CoachBubble>
 * side: which side the mascot stands on — "right" (default) or "left".
 * burst/eyesFilled pass straight through to the Mascot.
 */
export default function CoachBubble({
  species,
  mood = "idle",
  size = 48,
  side = "right",
  burst = 0,
  eyesFilled = false,
  children,
}) {
  const mascotRight = side === "right";
  return (
    <div className={`flex items-center gap-2.5 ${mascotRight ? "" : "flex-row-reverse"}`}>
      <div
        className={`pop relative min-w-0 rounded-2xl bg-white px-3 py-2 text-[13px] leading-snug text-slate-600 ring-1 ring-slate-200/70 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700/60`}
      >
        {children}
        {/* the tail: a rotated square sharing the bubble's fill, with only its two
            outward edges drawn so the hairline reads as one continuous outline */}
        <span
          aria-hidden="true"
          className={`${TAIL} ${
            mascotRight
              ? `-right-[5px] border-r border-t ${EDGE}`
              : `-left-[5px] border-b border-l ${EDGE}`
          }`}
        />
      </div>
      <div className="shrink-0">
        <Mascot species={species} mood={mood} size={size} burst={burst} eyesFilled={eyesFilled} />
      </div>
    </div>
  );
}
