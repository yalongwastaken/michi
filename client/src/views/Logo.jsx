// Logo.jsx — Michi's winding-trail mark: a moss-green path up a cream tile to a
// terracotta summit flag. Flat colors, no gradients; favicon.svg mirrors this exactly.
export function Logo({ className = "" }) {
  return (
    <svg viewBox="0 0 512 512" className={className} role="img" aria-label="Michi">
      <rect width="512" height="512" rx="112" fill="#FFF6E9" />
      {/* the path: trailhead → milestone → summit */}
      <path
        d="M120 420 C 200 380, 150 300, 240 280 C 330 260, 300 180, 384 150"
        fill="none"
        stroke="#4E8640"
        strokeWidth="22"
        strokeLinecap="round"
      />
      <circle cx="120" cy="420" r="24" fill="#3E6E33" />
      <circle cx="240" cy="280" r="15" fill="#CB744E" />
      {/* summit cairn + flag in terracotta */}
      <circle cx="384" cy="150" r="24" fill="#6A3020" />
      <path d="M384 150 L384 84" stroke="#6A3020" strokeWidth="13" strokeLinecap="round" />
      <path d="M384 82 L438 100 L384 118 Z" fill="#B95530" />
    </svg>
  );
}
