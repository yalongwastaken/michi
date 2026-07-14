// Logo.jsx — Michi's winding-trail mark: a persimmon path up a cream tile to an
// indigo summit flag. Flat colors, no gradients; favicon.svg mirrors this exactly.
export function Logo({ className = "" }) {
  return (
    <svg viewBox="0 0 512 512" className={className} role="img" aria-label="Michi">
      <rect width="512" height="512" rx="112" fill="#FFF6E9" />
      {/* the path: trailhead → milestone → summit */}
      <path
        d="M120 420 C 200 380, 150 300, 240 280 C 330 260, 300 180, 384 150"
        fill="none"
        stroke="#F25C05"
        strokeWidth="22"
        strokeLinecap="round"
      />
      <circle cx="120" cy="420" r="24" fill="#E04E00" />
      <circle cx="240" cy="280" r="15" fill="#808CC9" />
      {/* summit cairn + flag in indigo */}
      <circle cx="384" cy="150" r="24" fill="#2C3456" />
      <path d="M384 150 L384 84" stroke="#2C3456" strokeWidth="13" strokeLinecap="round" />
      <path d="M384 82 L438 100 L384 118 Z" fill="#4F5D9E" />
    </svg>
  );
}
