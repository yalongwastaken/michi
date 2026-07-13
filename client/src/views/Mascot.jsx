// Mascot.jsx — Michi the shiba, a flat-sticker trail companion. One shared body;
// moods swap only the small parts (ears, eyes, mouth, paws). Decorative everywhere
// it appears, so it's aria-hidden — neighboring text carries the meaning. The
// breathing idle lives in index.css behind prefers-reduced-motion.
const BODY = "#E8A87C";
const CREAM = "#FFF4E0";
const DARK = "#3D3D3D";
const BLUSH = "#F0A3A0";

export default function Mascot({ mood = "neutral", size = 64 }) {
  const sleepy = mood === "sleepy";
  const celebrate = mood === "celebrate";
  const happyEyes = mood === "happy" || celebrate;
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} aria-hidden="true" focusable="false">
      {/* curled tail, peeking out beside the haunch */}
      <circle cx="96" cy="88" r="11" fill={BODY} />
      <circle cx="96" cy="88" r="5" fill={CREAM} />

      <g className="mascot-breathe">
        {/* sitting body + cream chest */}
        <ellipse cx="60" cy="90" rx="29" ry="22" fill={BODY} />
        <ellipse cx="60" cy="94" rx="15" ry="17" fill={CREAM} />

        {/* paws: up and cheering, or tucked in front */}
        {celebrate ? (
          <>
            <ellipse cx="29" cy="70" rx="6.5" ry="11" fill={BODY} transform="rotate(-35 29 70)" />
            <ellipse cx="91" cy="70" rx="6.5" ry="11" fill={BODY} transform="rotate(35 91 70)" />
          </>
        ) : (
          <>
            <ellipse cx="48" cy="108" rx="7" ry="4.5" fill={CREAM} stroke={BODY} strokeWidth="2" />
            <ellipse cx="72" cy="108" rx="7" ry="4.5" fill={CREAM} stroke={BODY} strokeWidth="2" />
          </>
        )}

        {/* ears: pointed, or drooping when sleepy */}
        {sleepy ? (
          <>
            <path d="M54 24 L30 13 L38 35 Z" fill={BODY} />
            <path d="M66 24 L90 13 L82 35 Z" fill={BODY} />
          </>
        ) : (
          <>
            <path d="M36 34 L42 8 L57 23 Z" fill={BODY} />
            <path d="M40 28 L43 15 L51 23 Z" fill={CREAM} />
            <path d="M84 34 L78 8 L63 23 Z" fill={BODY} />
            <path d="M80 28 L77 15 L69 23 Z" fill={CREAM} />
          </>
        )}

        {/* head + muzzle */}
        <circle cx="60" cy="46" r="26" fill={BODY} />
        <ellipse cx="60" cy="56" rx="14" ry="10" fill={CREAM} />

        {/* eyes: dots, closed-happy arcs, or flat asleep lines */}
        {happyEyes ? (
          <g stroke={DARK} strokeWidth="2.5" strokeLinecap="round" fill="none">
            <path d="M43 45 Q48 39 53 45" />
            <path d="M67 45 Q72 39 77 45" />
          </g>
        ) : sleepy ? (
          <g stroke={DARK} strokeWidth="2.5" strokeLinecap="round">
            <path d="M44 44 L53 44" />
            <path d="M67 44 L76 44" />
          </g>
        ) : (
          <g fill={DARK}>
            <circle cx="48" cy="44" r="3" />
            <circle cx="72" cy="44" r="3" />
          </g>
        )}

        {/* blush when pleased */}
        {happyEyes ? (
          <g fill={BLUSH}>
            <ellipse cx="40" cy="52" rx="4" ry="2.4" />
            <ellipse cx="80" cy="52" rx="4" ry="2.4" />
          </g>
        ) : null}

        {/* nose + mouth: open cheer, or a gentle smile */}
        <ellipse cx="60" cy="52" rx="3.5" ry="2.5" fill={DARK} />
        {celebrate ? (
          <>
            <path d="M53 58 Q60 68 67 58 Z" fill={DARK} />
            <path d="M56.5 60.5 Q60 65.5 63.5 60.5 Z" fill={BLUSH} />
          </>
        ) : (
          <path
            d="M55 59 Q60 63 65 59"
            stroke={DARK}
            strokeWidth="2"
            strokeLinecap="round"
            fill="none"
          />
        )}
      </g>

      {/* drifting-off zzz */}
      {sleepy ? (
        <g fill="#94A3B8" fontWeight="700">
          <text x="88" y="28" fontSize="13">
            z
          </text>
          <text x="98" y="17" fontSize="9">
            z
          </text>
        </g>
      ) : null}
    </svg>
  );
}
