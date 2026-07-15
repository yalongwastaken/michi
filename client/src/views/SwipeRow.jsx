import { useRef, useState } from "react";
import { Check, Pencil } from "lucide-react";

// two-stage leading swipe (à la Apple Mail): drag a row to the right and —
//   • past the first threshold, release opens context (edit) — a short swipe
//   • past the far threshold, release completes it instantly — a full, fast swipe
// The colour + label under the row switch at the far threshold so it's clear which
// one a release will fire. `touch-action: pan-y` lets vertical scrolling stay native;
// only horizontal drags come to us. Falls back to plain taps everywhere (the row's
// own buttons still work), so non-touch and the render tests are unaffected.
const CONTEXT_AT = 72; // px dragged → release opens context
const COMPLETE_AT = 150; // px dragged → release completes
const MAX = 210; // clamp so the row can't fly off

export default function SwipeRow({ onComplete, onContext, disabled = false, children }) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef(null); // { x, y, locked: null | "h" | "v" }
  const suppressClick = useRef(false);

  const enabled = !disabled && (onComplete || onContext);

  const onPointerDown = (e) => {
    if (!enabled || (e.pointerType === "mouse" && e.button !== 0)) {
      return;
    }
    start.current = { x: e.clientX, y: e.clientY, locked: null };
    setDragging(true);
  };

  const onPointerMove = (e) => {
    const s = start.current;
    if (!s) {
      return;
    }
    const ddx = e.clientX - s.x;
    const ddy = e.clientY - s.y;
    if (s.locked === null) {
      if (Math.abs(ddx) < 6 && Math.abs(ddy) < 6) {
        return; // below slop — don't decide the axis yet
      }
      s.locked = Math.abs(ddx) > Math.abs(ddy) ? "h" : "v";
      if (s.locked === "h") {
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* capture is best-effort */
        }
      }
    }
    if (s.locked !== "h") {
      return; // vertical → let the list scroll natively
    }
    setDx(Math.max(0, Math.min(ddx, MAX)));
  };

  const onPointerUp = () => {
    const s = start.current;
    start.current = null;
    setDragging(false);
    if (!s) {
      return;
    }
    if (s.locked === "h") {
      suppressClick.current = true; // a deliberate drag must not also fire a tap
      setTimeout(() => (suppressClick.current = false), 0);
    }
    const d = dx;
    setDx(0);
    if (d >= COMPLETE_AT && onComplete) {
      onComplete();
    } else if (d >= CONTEXT_AT && onContext) {
      onContext();
    }
  };

  const willComplete = dx >= COMPLETE_AT;
  // "context" fill only makes sense when there IS a context action; otherwise the
  // whole track reads as the completion action
  const contextStage = onContext && !willComplete;

  return (
    <div
      className="relative overflow-hidden"
      style={{ touchAction: "pan-y" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClickCapture={(e) => {
        if (suppressClick.current) {
          e.preventDefault();
          e.stopPropagation();
          suppressClick.current = false;
        }
      }}
    >
      {dx > 0 ? (
        <div
          aria-hidden="true"
          className={`absolute inset-y-0 left-0 flex items-center gap-1.5 px-4 text-sm font-medium text-white ${
            contextStage ? "bg-iris-500" : "bg-trail-600"
          }`}
          style={{ width: dx }}
        >
          {contextStage ? (
            <>
              <Pencil size={16} /> Details
            </>
          ) : (
            <>
              <Check size={16} strokeWidth={3} /> Done
            </>
          )}
        </div>
      ) : null}
      <div
        style={{
          transform: `translateX(${dx}px)`,
          transition: dragging ? "none" : "transform 0.2s ease",
        }}
      >
        {children}
      </div>
    </div>
  );
}
