// Mascot.jsx — the michi companion engine. Nine species share one construction
// (the approved v14 skeleton): a single unified silhouette on a 120×150 grid, one
// shadow ribbon hugging the right inside edge, one light ribbon on the left, a
// chest mass that tapers into two front paws, and the exact same face + persimmon
// scarf + bell across every quadruped. Only ears, tail, markings, and palette vary.
// The daruma is its own body (no ears, no paws) but shares the aura/confetti layers.
//
// <Mascot species mood size eyesFilled burst />
//   species: shiba | panda | daruma | kitsune | tanuki | raccoon | maneki | rabbit | crane
//   mood:    idle | happy | celebrate | sleepy | waypoint | fire | locked
//            (ambient loops: idle/sleepy/fire/locked · one-shot bursts: happy/celebrate/waypoint)
//   burst:   a counter — bump it to replay the current mood's one-shot animation
//   eyesFilled: daruma only — paints the second eye (the goal-met ritual)
//
// Decorative everywhere it appears, so aria-hidden. All motion lives in index.css
// (class-scoped .mascot-*) behind prefers-reduced-motion, same discipline as before.

const INK = "#453833";
const CREAM = "#FFF6E9";
const BLUSH = "#F4A28C";
const TRAIL = "#F25C05";
const TRAIL_LT = "#FF7A2E";
const TRAIL_DK = "#C43F00";
const GOLD = "#E8A13C";
const GOLD_DK = "#C97F1E";
const GOLD_LT = "#F4B95C";
const INDIGO = "#2C3456";
const IRIS = "#4F5D9E";

// ── the shared skeleton (approved geometry — do not eyeball-tweak) ─────────────
// silhouette = M44 16 + left ear + MID (head sides, body, feet bumps) + right ear + head top
const MID =
  "C26 55 30 62 36 66 C32 72 30 80 29 90 C28 100 28 110 30 118 C32 128 36 133 43 136 " +
  "L45 137 C47 139 51 139 53 137 L67 137 C69 139 73 139 75 137 L77 136 C84 133 88 128 90 118 " +
  "C92 110 92 100 91 90 C90 80 88 72 84 66 C90 62 94 55 94 46";
const EAR = {
  tri: { l: "L30 6 L36 26 C30 30 26 38 26 46", r: "C94 38 90 30 84 26 L90 6 L76 16" },
  round: {
    l: "C42 10 37 6 32 7 C25 9 23 17 27 23 C28.5 25.5 31 27 34 27 C29 31 26 38 26 46",
    r: "C94 38 91 31 86 27 C89 27 91.5 25.5 93 23 C97 17 95 9 88 7 C83 6 78 10 76 16",
  },
  tall: { l: "L27 2 L36 26 C30 30 26 38 26 46", r: "C94 38 90 30 84 26 L93 2 L76 16" },
  cat: { l: "L32 9 L37 25 C30 30 26 38 26 46", r: "C94 38 90 30 83 25 L88 9 L76 16" },
};
const quadPath = (ear) => `M44 16 ${ear.l} ${MID} ${ear.r} C66 12 54 12 44 16 Z`;
// rabbit: long lobes rising from the crown; crane: a smooth dome (no ears at all)
const RABBIT_PATH =
  `M56 8 C51 4 47 0 42 2 C36 5 33 15 33 27 C29 30 26 38 26 46 ${MID} ` +
  "C94 38 91 30 87 27 C87 15 84 5 78 2 C73 0 69 4 64 8 C61 9.5 59 9.5 56 8 Z";
const CRANE_PATH = `M60 14 C46 14 36 19 33 27 C29 30 26 38 26 46 ${MID} C94 38 91 30 87 27 C84 19 74 14 60 14 Z`;

const RIBBON_R =
  "M84 26 C89 31 92 38 92 46 C92 54 89 61 83 65 C87 71 89 80 90 90 C91 100 91 110 89 118 " +
  "C87 127 83 132 77 135 C82 127 85 117 85 106 C85 95 84 84 81 74 C80 70 78 67 77 65 " +
  "C82 60 86 54 86 46 C86 39 85 32 84 26 Z";
const RIBBON_L =
  "M36 26 C31 31 28 38 28 46 C28 54 31 61 37 65 C33 71 31 80 30 90 C29 100 29 110 31 118 " +
  "C32.5 125 35 130 39 133 C36 126 34 117 34 107 C34 96 35 85 38 75 C39 71 40 67 42 65 " +
  "C36 60 32 54 32 46 C32 39 33 32 36 26 Z";
const BELLY =
  "M60 70 C52 70 46 75 45 84 C44 102 44 118 46 128 C47 133 49 135.5 53 135.5 C56 135.5 58 134 60 134 " +
  "C62 134 64 135.5 67 135.5 C71 135.5 73 133 74 128 C76 118 76 102 75 84 C74 75 68 70 60 70 Z";
const CARVE = "M60 112 C56.8 117 55.5 126 56.5 134 L63.5 134 C64.5 126 63.2 117 60 112 Z";
const TOES = "M49 135 v-3 M53 135.3 v-3 M67 135.3 v-3 M71 135 v-3";

// ── species part definitions ────────────────────────────────────────────────────
const SPECIES = {
  shiba: {
    label: "Shiba",
    body: "#E88A4A",
    shade: "#C96F35",
    light: "#F5A66B",
    lightO: 0.4,
    iris: "#8A5A2B",
    belly: CREAM,
    carve: "#DFC49E",
    toe: "#DFC49E",
    scarfShadow: "#DFC49E",
    path: quadPath(EAR.tri),
    tail: (
      <g>
        <circle cx="97" cy="90" r="12" fill="#C96F35" />
        <circle cx="97" cy="90" r="8.3" fill="#E88A4A" />
        <circle cx="97" cy="90" r="4.6" fill={CREAM} />
        <path
          d="M87 82 A11 11 0 0 1 104 80"
          stroke="#F5A66B"
          strokeWidth="2.4"
          fill="none"
          strokeLinecap="round"
          opacity="0.85"
        />
      </g>
    ),
    earInner: (
      <g>
        <path d="M35 23 L32 12 L41 17.5 Z" fill="#A0552A" />
        <path d="M35.5 20.5 L34 14.5 L39.5 17 Z" fill={BLUSH} />
        <path d="M85 23 L88 12 L79 17.5 Z" fill="#A0552A" />
        <path d="M84.5 20.5 L86 14.5 L80.5 17 Z" fill={BLUSH} />
      </g>
    ),
  },

  panda: {
    label: "Red panda",
    body: "#C25E32",
    shade: "#96431F",
    light: "#D97A4A",
    lightO: 0.45,
    iris: "#4A2E1C",
    belly: "#7A3A1C",
    carve: "#4A2210",
    carveO: 0.95,
    toe: "#3A1A0B",
    scarfShadow: "#5F2C14",
    nose: "#2B2320",
    browDots: [
      [45, 32, 4.5, 3.2],
      [75, 32, 4.5, 3.2],
    ],
    blush: [
      [33, 61, 3.6, 2.2],
      [87, 61, 3.6, 2.2],
    ],
    path: quadPath(EAR.round),
    tail: (
      <g>
        <ellipse cx="99" cy="112" rx="11" ry="24" transform="rotate(-12 99 112)" fill="#C25E32" />
        <ellipse cx="102" cy="97" rx="8" ry="5.5" transform="rotate(-12 102 97)" fill="#7A3A1C" />
        <ellipse
          cx="97.5"
          cy="115"
          rx="8"
          ry="5.5"
          transform="rotate(-12 97.5 115)"
          fill="#7A3A1C"
        />
        <ellipse cx="94" cy="130" rx="7.5" ry="5" transform="rotate(-12 94 130)" fill="#7A3A1C" />
        <path
          d="M92 92 A10 22 -12 0 1 104 91"
          stroke="#D97A4A"
          strokeWidth="2.2"
          fill="none"
          strokeLinecap="round"
          opacity="0.8"
        />
      </g>
    ),
    earInner: (
      <g>
        <path
          d="M29.5 21 C27 17 28.5 11.5 33 10.5"
          stroke={CREAM}
          strokeWidth="2.6"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M90.5 21 C93 17 91.5 11.5 87 10.5"
          stroke={CREAM}
          strokeWidth="2.6"
          fill="none"
          strokeLinecap="round"
        />
        <circle cx="33" cy="17" r="4.2" fill="#7A3A1C" />
        <circle cx="87" cy="17" r="4.2" fill="#7A3A1C" />
      </g>
    ),
    cheeks: (
      <g>
        <ellipse cx="32" cy="56" rx="7" ry="6.5" fill={CREAM} />
        <ellipse cx="88" cy="56" rx="7" ry="6.5" fill={CREAM} />
        <path
          d="M41 50 Q38 56 35 59"
          stroke="#7A3A1C"
          strokeWidth="3.2"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M79 50 Q82 56 85 59"
          stroke="#7A3A1C"
          strokeWidth="3.2"
          fill="none"
          strokeLinecap="round"
        />
      </g>
    ),
  },

  daruma: { label: "Daruma" }, // its own renderer below

  kitsune: {
    label: "Kitsune",
    body: CREAM,
    shade: "#EAD9BE",
    light: "#FFFDF8",
    lightO: 0.5,
    iris: IRIS,
    belly: "#FDEEDA",
    carve: "#E8D2A8",
    toe: "#DFC49E",
    scarfShadow: "#E8D2A8",
    path: quadPath(EAR.tall),
    tail: (
      <g>
        <ellipse cx="20" cy="112" rx="10.5" ry="23" transform="rotate(18 20 112)" fill={TRAIL} />
        <ellipse
          cx="22"
          cy="119"
          rx="6.5"
          ry="13"
          transform="rotate(18 22 119)"
          fill={TRAIL_DK}
          opacity="0.85"
        />
        <ellipse cx="14" cy="92.5" rx="5.5" ry="7" transform="rotate(24 14 92.5)" fill={CREAM} />
        <path
          d="M25 96 A10 21 18 0 0 12.5 97"
          stroke={TRAIL_LT}
          strokeWidth="2.2"
          fill="none"
          strokeLinecap="round"
          opacity="0.8"
        />
      </g>
    ),
    earInner: (
      <g>
        <path d="M34.5 21 L29.5 6 L40 16.5 Z" fill={TRAIL} />
        <path d="M35 17.5 L31.8 8.5 L38.5 15 Z" fill={TRAIL_DK} />
        <path d="M85.5 21 L90.5 6 L80 16.5 Z" fill={TRAIL} />
        <path d="M85 17.5 L88.2 8.5 L81.5 15 Z" fill={TRAIL_DK} />
      </g>
    ),
    markings: (
      <g>
        <path d="M36 26 C40 7 80 7 84 26 C72 19 48 19 36 26 Z" fill={TRAIL} />
        <path
          d="M40 21.5 C48 13.5 72 13.5 80 21.5"
          stroke={TRAIL_LT}
          strokeWidth="1.6"
          fill="none"
          strokeLinecap="round"
          opacity="0.85"
        />
        <g stroke="#E24B4A" strokeWidth="1.4" strokeLinecap="round">
          <path d="M27 47.5 h6.5" />
          <path d="M27.5 51 h5.5" />
          <path d="M86.5 47.5 h6.5" />
          <path d="M87 51 h5.5" />
        </g>
      </g>
    ),
  },

  tanuki: {
    label: "Tanuki",
    body: "#A08770",
    shade: "#86705C",
    light: "#BCA891",
    lightO: 0.45,
    iris: "#8A5A2B",
    belly: "#EFE0CE",
    carve: "#C9B192",
    toe: "#C9B192",
    scarfShadow: "#C9B192",
    path: quadPath(EAR.round),
    tail: (
      <g>
        <ellipse cx="99" cy="112" rx="11" ry="24" transform="rotate(-12 99 112)" fill="#A08770" />
        <ellipse cx="94" cy="130" rx="8" ry="6.5" transform="rotate(-12 94 130)" fill="#4A3B30" />
        <path
          d="M92 92 A10 22 -12 0 1 104 91"
          stroke="#BCA891"
          strokeWidth="2.2"
          fill="none"
          strokeLinecap="round"
          opacity="0.8"
        />
      </g>
    ),
    earInner: (
      <g>
        <circle cx="33" cy="17" r="4.2" fill="#4A3B30" />
        <circle cx="87" cy="17" r="4.2" fill="#4A3B30" />
        <circle cx="33.8" cy="17.6" r="1.7" fill="#EFE0CE" />
        <circle cx="86.2" cy="17.6" r="1.7" fill="#EFE0CE" />
      </g>
    ),
    markings: (
      <g>
        <path d="M60 14 C56 10 56.5 4 60.5 2.5 C63 6.5 62.5 11 60 14 Z" fill="#8AA65F" />
        <path d="M60 14 L59.2 17.5" stroke="#6E8A48" strokeWidth="1.4" strokeLinecap="round" />
      </g>
    ),
    maskFace: (
      <g>
        <ellipse cx="45" cy="45.5" rx="8" ry="6.8" fill="#4A3B30" />
        <ellipse cx="75" cy="45.5" rx="8" ry="6.8" fill="#4A3B30" />
        <ellipse cx="45" cy="43" rx="6.8" ry="4.2" fill="#5C4A3B" />
        <ellipse cx="75" cy="43" rx="6.8" ry="4.2" fill="#5C4A3B" />
      </g>
    ),
  },

  raccoon: {
    label: "Raccoon",
    body: "#7D829B",
    shade: "#666B85",
    light: "#9BA0B8",
    lightO: 0.45,
    iris: GOLD_DK,
    belly: "#DDDFE8",
    carve: "#C3C6D6",
    toe: "#3A3F58",
    scarfShadow: "#B9BDD0",
    mouthExtra: "M67 61 q3.5 -0.5 4.5 -3.5",
    path: quadPath(EAR.tri),
    tail: (
      <g>
        <ellipse cx="21" cy="112" rx="11" ry="24" transform="rotate(12 21 112)" fill="#7D829B" />
        <ellipse cx="18" cy="97" rx="8" ry="5.5" transform="rotate(12 18 97)" fill="#3A3F58" />
        <ellipse
          cx="22.5"
          cy="115"
          rx="8"
          ry="5.5"
          transform="rotate(12 22.5 115)"
          fill="#3A3F58"
        />
        <ellipse cx="26" cy="130" rx="7.5" ry="5" transform="rotate(12 26 130)" fill="#3A3F58" />
        <path
          d="M28 92 A10 22 12 0 0 16 91"
          stroke="#9BA0B8"
          strokeWidth="2.2"
          fill="none"
          strokeLinecap="round"
          opacity="0.8"
        />
      </g>
    ),
    earInner: (
      <g>
        <path d="M35 23 L32 12 L41 17.5 Z" fill="#3A3F58" />
        <path d="M35.5 20.5 L34 14.5 L39.5 17 Z" fill="#9BA0B8" />
        <path d="M85 23 L88 12 L79 17.5 Z" fill="#3A3F58" />
        <path d="M84.5 20.5 L86 14.5 L80.5 17 Z" fill="#9BA0B8" />
      </g>
    ),
    maskFace: (
      <g>
        <path
          d="M32.5 41 C38 35.8 49 37.6 60 42.5 C71 37.6 82 35.8 87.5 41 C88 47.5 82.5 52 74.5 50.7 C68.5 49.7 63 47.8 60 47.8 C57 47.8 51.5 49.7 45.5 50.7 C37.5 52 32 47.5 32.5 41 Z"
          fill="#3A3F58"
        />
        <path
          d="M34.5 40.5 C40 36.8 50 38.8 60 43.2 C70 38.8 80 36.8 85.5 40.5 C83.5 44.5 76.5 46.3 70.5 45.2 C65.5 44.3 62 43.6 60 43.6 C58 43.6 54.5 44.3 49.5 45.2 C43.5 46.3 36.5 44.5 34.5 40.5 Z"
          fill="#4A5070"
        />
      </g>
    ),
  },

  maneki: {
    label: "Maneki",
    body: "#FDFBF6",
    shade: "#E5DCC8",
    light: "#FFFFFF",
    lightO: 0.5,
    iris: IRIS,
    belly: "#FFFFFF",
    carve: "#E8DFCB",
    toe: "#DCCFB4",
    scarfShadow: "#E8DFCB",
    nose: BLUSH,
    mouth: "M52.5 59.5 q3.75 4.5 7.5 0 q3.75 4.5 7.5 0",
    pendant: "koban",
    path: quadPath(EAR.cat),
    tail: (
      <g fill="none" strokeLinecap="round">
        <path d="M85 129 C101 127 106 112 94 107" stroke="#E5DCC8" strokeWidth="9" />
        <path d="M85 129 C101 127 106 112 94 107" stroke="#FDFBF6" strokeWidth="6" />
        <circle cx="94" cy="107" r="4.4" fill={TRAIL} stroke="none" />
      </g>
    ),
    earInner: (
      <g>
        <path d="M36.5 21 L34 12.5 L40.5 16.5 Z" fill={BLUSH} />
        <path d="M83.5 21 L86 12.5 L79.5 16.5 Z" fill={BLUSH} />
      </g>
    ),
    markings: (
      <g>
        <path
          d="M76 16 L88 9 L83.5 24 C86.5 27.5 88 33 88.5 38.5 C83.5 34 77.5 30.5 73.5 28 C72 23 73 18.5 76 16 Z"
          fill={TRAIL}
        />
        <path
          d="M78.5 17 L86 12.5 L82.5 23 C80 21 78 18.8 78.5 17 Z"
          fill={TRAIL_LT}
          opacity="0.9"
        />
      </g>
    ),
    whiskers: (
      <g stroke="#C9C2B4" strokeWidth="1.3" strokeLinecap="round">
        <path d="M25.5 48.5 h8.5" />
        <path d="M25 53 h9" />
        <path d="M86 48.5 h8.5" />
        <path d="M86 53 h9" />
      </g>
    ),
  },

  rabbit: {
    label: "Rabbit",
    body: "#ECEDF4",
    shade: "#C9CBD8",
    light: "#F8F8FC",
    lightO: 0.5,
    iris: INDIGO,
    belly: "#F8F8FC",
    carve: "#D3D5E2",
    toe: "#C9CBD8",
    scarfShadow: "#D3D5E2",
    nose: BLUSH,
    path: RABBIT_PATH,
    tail: (
      <g>
        <circle cx="94" cy="116" r="8" fill="#C9CBD8" />
        <circle cx="93" cy="115" r="7" fill="#FFFFFF" />
        <circle cx="91" cy="113" r="3" fill="#ECEDF4" />
      </g>
    ),
    earInner: (
      <g>
        <ellipse
          cx="44"
          cy="14"
          rx="3.6"
          ry="8.5"
          transform="rotate(14 44 14)"
          fill={BLUSH}
          opacity="0.9"
        />
        <ellipse
          cx="76"
          cy="14"
          rx="3.6"
          ry="8.5"
          transform="rotate(-14 76 14)"
          fill={BLUSH}
          opacity="0.9"
        />
      </g>
    ),
    markings: (
      <path d="M37 96 A7.5 7.5 0 1 0 44.5 105 A6 6 0 1 1 37 96 Z" fill={IRIS} opacity="0.55" />
    ),
  },

  crane: {
    label: "Crane",
    body: "#FDFBF6",
    shade: "#EDE5D4",
    light: "#FFFFFF",
    lightO: 0.5,
    iris: IRIS,
    belly: "#F3EDE1",
    carve: "#DFD4BC",
    toe: "#DFD4BC",
    scarfShadow: "#DFD4BC",
    path: CRANE_PATH,
    noseShape: "beak",
    tail: (
      <g>
        <ellipse cx="93" cy="112" rx="4.5" ry="12" transform="rotate(-32 93 112)" fill={INDIGO} />
        <ellipse cx="95" cy="109" rx="3" ry="8.5" transform="rotate(-34 95 109)" fill={IRIS} />
      </g>
    ),
    earInner: null,
    markings: (
      <g>
        <ellipse cx="60" cy="17.5" rx="7.5" ry="4" fill="#E24B4A" />
        <ellipse cx="58" cy="16.5" rx="3.6" ry="1.8" fill="#F06B6B" />
        <ellipse cx="33" cy="96" rx="6" ry="16" transform="rotate(7 33 96)" fill={INDIGO} />
        <ellipse cx="33.5" cy="96" rx="3.2" ry="11.5" transform="rotate(7 33.5 96)" fill={IRIS} />
        <ellipse cx="87" cy="96" rx="6" ry="16" transform="rotate(-7 87 96)" fill={INDIGO} />
        <ellipse cx="86.5" cy="96" rx="3.2" ry="11.5" transform="rotate(-7 86.5 96)" fill={IRIS} />
      </g>
    ),
    feet: (
      <g>
        <ellipse cx="52.5" cy="133" rx="6.5" ry="4.2" fill={GOLD} />
        <ellipse cx="67.5" cy="133" rx="6.5" ry="4.2" fill={GOLD} />
        <path
          d="M49 135.5 v-3.5 M53 135.8 v-3.5 M67 135.8 v-3.5 M71 135.5 v-3.5"
          stroke={GOLD_DK}
          strokeWidth="1.5"
          strokeLinecap="round"
          fill="none"
        />
      </g>
    ),
  },
};

export const SPECIES_LIST = Object.entries(SPECIES).map(([id, s]) => ({ id, label: s.label }));

// ── shared face + scarf pieces ──────────────────────────────────────────────────
function Eyes({ kind, iris }) {
  if (kind === "happy") {
    return (
      <g className="mascot-eyesh" stroke={INK} strokeWidth="2.4" strokeLinecap="round" fill="none">
        <path d="M40 46.5 Q45 40.5 50 46.5" />
        <path d="M70 46.5 Q75 40.5 80 46.5" />
      </g>
    );
  }
  if (kind === "sleepy") {
    return (
      <g className="mascot-eyess" stroke={INK} strokeWidth="2.4" strokeLinecap="round" fill="none">
        <path d="M40.5 45 Q45 48 49.5 45" />
        <path d="M70.5 45 Q75 48 79.5 45" />
      </g>
    );
  }
  return (
    <g className="mascot-eyeso">
      <ellipse cx="45" cy="45" rx="5" ry="5.8" fill="#FFFFFF" />
      <ellipse cx="75" cy="45" rx="5" ry="5.8" fill="#FFFFFF" />
      <circle cx="45.5" cy="45.5" r="3.3" fill={iris} />
      <circle cx="74.5" cy="45.5" r="3.3" fill={iris} />
      <circle cx="46" cy="46" r="1.7" fill="#2B2320" />
      <circle cx="74" cy="46" r="1.7" fill="#2B2320" />
      <circle cx="44.2" cy="43.6" r="1.2" fill="#FFFFFF" />
      <circle cx="73.2" cy="43.6" r="1.2" fill="#FFFFFF" />
    </g>
  );
}

function Mouth({ mood, sp }) {
  if (mood === "celebrate") {
    return (
      <g>
        <path d="M53 59.5 Q60 69.5 67 59.5 Z" fill={INK} />
        <path d="M56.5 62.5 Q60 66.5 63.5 62.5 Z" fill={BLUSH} />
      </g>
    );
  }
  if (mood === "sleepy" || mood === "locked") {
    return (
      <path d="M54 61.5 h12" stroke={INK} strokeWidth="2.2" strokeLinecap="round" fill="none" />
    );
  }
  if (mood === "fire") {
    return (
      <g stroke={INK} strokeWidth="2.2" strokeLinecap="round" fill="none">
        <path d="M53 61 q7 5 14 0" />
        <path d="M67 61 q3.5 -0.5 4.5 -3.5" />
      </g>
    );
  }
  return (
    <g stroke={INK} strokeWidth="2.2" strokeLinecap="round" fill="none">
      <path d={sp.mouth || "M53 61 q7 5 14 0"} />
      {sp.mouthExtra ? <path d={sp.mouthExtra} /> : null}
    </g>
  );
}

function Nose({ sp }) {
  if (sp.noseShape === "beak") {
    return (
      <g>
        <path d="M55 51 h10 l-5 7 Z" fill={GOLD} />
        <path d="M55 51 h10 l-1.6 2.2 h-6.8 Z" fill={GOLD_LT} />
      </g>
    );
  }
  return <path d="M56 52 h8 l-4 5 Z" fill={sp.nose || INK} />;
}

function Scarf({ shadow, pendant }) {
  return (
    <g>
      <path d="M36 62 Q60 77 84 62 L84 70 Q60 85 36 70 Z" fill={TRAIL} />
      <path d="M36 62 Q60 77 84 62 L84 65.5 Q60 80.5 36 65.5 Z" fill={TRAIL_LT} />
      <path d="M41 65 Q60 77 79 65" stroke={TRAIL_DK} strokeWidth="1.5" fill="none" opacity="0.5" />
      <path d="M41 71 Q60 84 79 71 Q60 88 41 71 Z" fill={shadow} opacity="0.5" />
      {pendant === "koban" ? (
        <g>
          <ellipse cx="60" cy="82" rx="5.2" ry="6.6" fill={GOLD} />
          <path
            d="M56.6 78.6 a5.2 6.6 0 0 1 4.6 -2"
            stroke={GOLD_LT}
            strokeWidth="1.4"
            fill="none"
            strokeLinecap="round"
          />
          <ellipse
            cx="60"
            cy="82"
            rx="5.2"
            ry="6.6"
            fill="none"
            stroke={GOLD_DK}
            strokeWidth="1.2"
          />
          <text x="60" y="85" textAnchor="middle" fontSize="7" fill="#7F2D03" fontFamily="serif">
            千
          </text>
        </g>
      ) : (
        <g>
          <circle cx="60" cy="81" r="4" fill={GOLD} />
          <path
            d="M57.2 79 a4 4 0 0 1 5.6 0"
            stroke={GOLD_LT}
            strokeWidth="1.5"
            fill="none"
            strokeLinecap="round"
          />
          <circle cx="60" cy="81" r="4" fill="none" stroke={GOLD_DK} strokeWidth="1.2" />
          <path d="M60 81.5 v2.6" stroke="#7F2D03" strokeWidth="1.2" strokeLinecap="round" />
        </g>
      )}
    </g>
  );
}

// ── the quadruped template: paint order is the whole trick ──────────────────────
function Quadruped({ sp, mood }) {
  const eyes =
    mood === "happy" || mood === "celebrate" || mood === "waypoint"
      ? "happy"
      : mood === "sleepy"
        ? "sleepy"
        : "open";
  const browDots = sp.browDots || [
    [45, 33, 4, 3],
    [75, 33, 4, 3],
  ];
  const blush = sp.blush || [
    [33, 54, 4, 2.5],
    [87, 54, 4, 2.5],
  ];
  return (
    <g>
      <g className="mascot-tailg">{sp.tail}</g>
      <path d={sp.path} fill={sp.body} />
      <path d={RIBBON_R} fill={sp.shade} opacity="0.5" />
      <path d={RIBBON_L} fill={sp.light} opacity={sp.lightO} />
      {sp.earInner}
      {sp.markings}
      <path d={BELLY} fill={sp.belly} />
      <path d={CARVE} fill={sp.carve} opacity={sp.carveO || 0.9} />
      {sp.feet || (
        <path d={TOES} stroke={sp.toe} strokeWidth="1.5" strokeLinecap="round" fill="none" />
      )}
      {browDots.map(([x, y, rx, ry]) => (
        <ellipse key={x} cx={x} cy={y} rx={rx} ry={ry} fill={CREAM} />
      ))}
      {sp.cheeks}
      {sp.maskFace}
      <ellipse cx="60" cy="57" rx="13" ry="10" fill={CREAM} />
      <Eyes kind={eyes} iris={sp.iris} />
      {mood === "locked" ? (
        <g
          className="mascot-browd"
          stroke={INK}
          strokeWidth="2.2"
          strokeLinecap="round"
          fill="none"
        >
          <path d="M39.5 35.5 L50.5 38.5" />
          <path d="M80.5 35.5 L69.5 38.5" />
        </g>
      ) : null}
      {sp.whiskers}
      <Nose sp={sp} />
      <Mouth mood={mood} sp={sp} />
      {blush.map(([x, y, rx, ry]) => (
        <ellipse key={x} cx={x} cy={y} rx={rx} ry={ry} fill={BLUSH} />
      ))}
      <Scarf shadow={sp.scarfShadow} pendant={sp.pendant} />
    </g>
  );
}

// ── the daruma: its own body, the shared aura layers ────────────────────────────
function DarumaBase() {
  return (
    <g>
      <path d="M18 120 Q60 132 102 120 L102 129 Q60 143 18 129 Z" fill={INDIGO} />
      <path d="M18 120 Q60 132 102 120 L102 123.5 Q60 136.5 18 123.5 Z" fill={IRIS} />
      <circle cx="20" cy="125" r="2" fill={GOLD} />
      <circle cx="100" cy="125" r="2" fill={GOLD} />
    </g>
  );
}

function DarumaBody({ eyesFilled }) {
  return (
    <g>
      <path
        d="M60 14 C32 14 21 42 21 78 C21 110 34 130 60 130 C86 130 99 110 99 78 C99 42 88 14 60 14 Z"
        fill="#E04E00"
      />
      <path
        d="M92 40 C97 52 99 66 98 80 C97 102 88 120 74 127 C86 116 92 100 92 80 C92 66 92 52 92 40 Z"
        fill="#B03B00"
        opacity="0.75"
      />
      <path d="M30 104 Q60 124 90 104 Q82 122 60 124 Q38 122 30 104 Z" fill="#B03B00" />
      <path
        d="M30 36 C25 48 23 62 23.5 78 C24 92 27 105 32 115 C29 104 27.5 92 27.5 78 C27.5 62 28.5 48 30 36 Z"
        fill="#F2703A"
        opacity="0.8"
      />
      <ellipse cx="60" cy="26" rx="20" ry="7" fill="#F2703A" opacity="0.7" />
      <path
        d="M60 30 C43 30 35 44 35 62 C35 84 45 96 60 96 C75 96 85 84 85 62 C85 44 77 30 60 30 Z"
        fill={CREAM}
      />
      <path
        d="M60 30 C43 30 35 44 35 62 C35 84 45 96 60 96 C75 96 85 84 85 62 C85 44 77 30 60 30 Z"
        fill="none"
        stroke={GOLD_DK}
        strokeWidth="3.6"
      />
      <path
        d="M60 30 C43 30 35 44 35 62 C35 84 45 96 60 96 C75 96 85 84 85 62 C85 44 77 30 60 30 Z"
        fill="none"
        stroke={GOLD}
        strokeWidth="1.6"
      />
      <path d="M40 42 C46 34 74 34 80 42 C74 38 46 38 40 42 Z" fill="#E5D0A8" opacity="0.8" />
      <path d="M78 52 C82 62 82 76 78 86 C81 76 81 60 78 52 Z" fill="#E5D0A8" opacity="0.9" />
      <path
        d="M40 50 C45 41 54 42 57 47"
        stroke={INDIGO}
        strokeWidth="4.2"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M80 50 C75 41 66 42 63 47"
        stroke={INDIGO}
        strokeWidth="4.2"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M42 48 C46 43 52 43.5 55 46.5"
        stroke={IRIS}
        strokeWidth="1.8"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M78 48 C74 43 68 43.5 65 46.5"
        stroke={IRIS}
        strokeWidth="1.8"
        fill="none"
        strokeLinecap="round"
      />
      <circle cx="46" cy="60" r="5.5" fill={INK} />
      <circle cx="44.6" cy="58.4" r="1.6" fill="#FFFFFF" />
      <circle cx="74" cy="60" r="5.5" fill="none" stroke={INK} strokeWidth="2.2" />
      {eyesFilled ? (
        <g className="mascot-eye2">
          <circle cx="74" cy="60" r="5.5" fill={INK} />
          <circle cx="72.6" cy="58.4" r="1.6" fill="#FFFFFF" />
        </g>
      ) : null}
      <ellipse cx="38" cy="70" rx="4" ry="2.5" fill={BLUSH} />
      <ellipse cx="82" cy="70" rx="4" ry="2.5" fill={BLUSH} />
      <path
        d="M47 74 C51 82 57 80 59 74"
        stroke={INK}
        strokeWidth="2.4"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M73 74 C69 82 63 80 61 74"
        stroke={INK}
        strokeWidth="2.4"
        fill="none"
        strokeLinecap="round"
      />
      <path d="M56 87 h8" stroke={INK} strokeWidth="2.2" strokeLinecap="round" />
      <path d="M40 97 Q60 108 80 97 L80 104 Q60 115 40 104 Z" fill={TRAIL} />
      <path d="M40 97 Q60 108 80 97 L80 100 Q60 111 40 100 Z" fill={TRAIL_LT} />
      <path
        d="M46 99 Q60 108 74 99"
        stroke={TRAIL_DK}
        strokeWidth="1.6"
        fill="none"
        opacity="0.5"
      />
      <path d="M72 105 l9 7 l-11 2 Z" fill={TRAIL_DK} />
      <path d="M42 106 Q60 116 78 106 L78 109 Q60 118 42 109 Z" fill="#B03B00" opacity="0.55" />
      <circle cx="78" cy="116" r="3.6" fill={GOLD} />
      <path
        d="M75.5 114 a3.6 3.6 0 0 1 5 0"
        stroke={GOLD_LT}
        strokeWidth="1.4"
        fill="none"
        strokeLinecap="round"
      />
      <circle cx="78" cy="116" r="3.6" fill="none" stroke={GOLD_DK} strokeWidth="1.2" />
      <path d="M78 116 v2.6" stroke="#7F2D03" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="60" cy="119" r="8" fill={GOLD_DK} />
      <circle cx="60" cy="118" r="6.6" fill={GOLD} />
      <path
        d="M55.5 114.5 a6.6 6.6 0 0 1 6 -2.6"
        stroke={GOLD_LT}
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
      />
      <text x="60" y="122" textAnchor="middle" fontSize="10" fill="#7F2D03" fontFamily="serif">
        道
      </text>
    </g>
  );
}

// ── mood layers (shared by every species) ───────────────────────────────────────
function FireAura() {
  return (
    <g className="mascot-aura-f">
      <path
        className="mascot-flame"
        d="M60 2 C40 30 27 64 30 96 C33 122 44 138 60 141 C76 138 87 122 90 96 C93 64 80 30 60 2 Z"
        fill={TRAIL}
        opacity="0.28"
      />
      <path
        className="mascot-flame mascot-f2"
        d="M60 18 C46 42 37 68 39 96 C41 118 49 132 60 135 C71 132 79 118 81 96 C83 68 74 42 60 18 Z"
        fill={TRAIL_LT}
        opacity="0.32"
      />
      <path
        className="mascot-flame mascot-f3"
        d="M60 36 C51 54 45 74 46 96 C47 114 53 126 60 128 C67 126 73 114 74 96 C75 74 69 54 60 36 Z"
        fill={GOLD_LT}
        opacity="0.35"
      />
    </g>
  );
}

function GoldAura() {
  return (
    <g className="mascot-aura-g">
      <circle
        className="mascot-ring"
        cx="60"
        cy="78"
        r="34"
        fill="none"
        stroke={GOLD}
        strokeWidth="2"
      />
      <circle
        className="mascot-ring mascot-ring2"
        cx="60"
        cy="78"
        r="34"
        fill="none"
        stroke={GOLD_LT}
        strokeWidth="1.6"
      />
      <g fill={GOLD}>
        <path className="mascot-spark" d="M24 34 l2.8 4.5 -2.8 4.5 -2.8 -4.5 Z" />
        <path
          className="mascot-spark"
          style={{ animationDelay: "0.2s" }}
          d="M97 28 l2.4 4 -2.4 4 -2.4 -4 Z"
        />
        <path
          className="mascot-spark"
          style={{ animationDelay: "0.45s" }}
          d="M20 104 l2.4 4 -2.4 4 -2.4 -4 Z"
        />
        <path
          className="mascot-spark"
          style={{ animationDelay: "0.3s" }}
          d="M100 110 l2.8 4.5 -2.8 4.5 -2.8 -4.5 Z"
        />
      </g>
    </g>
  );
}

function LockedAura() {
  return (
    <g className="mascot-aura-l">
      <circle cx="60" cy="78" r="38" fill="none" stroke={IRIS} strokeWidth="2" opacity="0.4" />
      <g stroke={IRIS} strokeWidth="2.4" strokeLinecap="round" fill="none">
        <path className="mascot-tick" d="M22 26 v-8 h8" />
        <path className="mascot-tick" style={{ animationDelay: "0.4s" }} d="M98 26 v-8 h-8" />
        <path className="mascot-tick" style={{ animationDelay: "0.8s" }} d="M22 128 v8 h8" />
        <path className="mascot-tick" style={{ animationDelay: "1.2s" }} d="M98 128 v8 h-8" />
      </g>
    </g>
  );
}

const CONFETTI = [
  [26, 6, "#F25C05", 0],
  [40, 2, "#5B67B7", 0.12],
  [54, 8, "#F59E0B", 0.05],
  [66, 3, "#F4A28C", 0.18],
  [80, 7, "#8AA65F", 0.08],
  [94, 4, "#5B67B7", 0.22],
  [34, 12, "#F59E0B", 0.28],
  [88, 12, "#F25C05", 0.3],
];

function Confetti() {
  return (
    <g className="mascot-confetti">
      {CONFETTI.map(([x, y, c, d], i) =>
        i % 3 === 2 ? (
          <circle
            key={i}
            className="mascot-conf"
            style={{ animationDelay: `${d}s` }}
            cx={x}
            cy={y}
            r="2.4"
            fill={c}
          />
        ) : (
          <rect
            key={i}
            className="mascot-conf"
            style={{ animationDelay: `${d}s` }}
            x={x - 2}
            y={y - 3.5}
            width="4"
            height="7"
            rx="1"
            fill={c}
          />
        ),
      )}
    </g>
  );
}

function Zz() {
  return (
    <g className="mascot-zz" fill="#94A3B8" fontWeight="700">
      <text x="86" y="24" fontSize="13">
        z
      </text>
      <text x="95" y="14" fontSize="9">
        z
      </text>
    </g>
  );
}

const MOODS = new Set(["idle", "happy", "celebrate", "sleepy", "waypoint", "fire", "locked"]);

export default function Mascot({
  species = "shiba",
  mood = "idle",
  size = 64,
  eyesFilled = false,
  burst = 0,
}) {
  const id = SPECIES[species] ? species : "shiba";
  const sp = SPECIES[id];
  let m = MOODS.has(mood) ? mood : "idle"; // old callers said "neutral" — same calm state
  if (id === "daruma" && m === "sleepy") {
    m = "idle"; // the daruma never sleeps on the goal
  }
  return (
    <svg
      viewBox="0 0 120 150"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={`mascot-svg mascot-${m} mascot-sp-${id}`}
    >
      {id === "daruma" ? (
        <DarumaBase />
      ) : (
        <ellipse cx="60" cy="140" rx="32" ry="5" fill="#8A8172" opacity="0.18" />
      )}
      {m === "fire" ? <FireAura /> : null}
      {/* auras sit behind the character — rings read as a halo, not a lasso */}
      {m === "waypoint" ? (
        <>
          <circle className="mascot-glow" cx="60" cy="78" r="44" fill={GOLD_LT} opacity="0.14" />
          <GoldAura />
        </>
      ) : null}
      {m === "locked" ? <LockedAura /> : null}
      {/* key: a mood switch or a burst bump remounts the group, replaying one-shots */}
      <g className="mascot-chr" key={`${m}-${burst}`}>
        {id === "daruma" ? <DarumaBody eyesFilled={eyesFilled} /> : <Quadruped sp={sp} mood={m} />}
      </g>
      {m === "celebrate" ? <Confetti /> : null}
      {m === "sleepy" ? <Zz /> : null}
    </svg>
  );
}
