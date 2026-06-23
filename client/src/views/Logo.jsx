// Logo.jsx — Michi's winding-trail mark, inline so it inherits currentColor sizing.
export function Logo({ className = "" }) {
  return (
    <svg viewBox="0 0 512 512" className={className} role="img" aria-label="Michi">
      <rect width="512" height="512" rx="112" fill="#ECFDF5" />
      <path
        d="M120 420 C 200 380, 150 300, 240 280 C 330 260, 300 180, 384 150"
        fill="none"
        stroke="#059669"
        strokeWidth="34"
        strokeLinecap="round"
        strokeDasharray="2 60"
      />
      <path
        d="M120 420 C 200 380, 150 300, 240 280 C 330 260, 300 180, 384 150"
        fill="none"
        stroke="#10B981"
        strokeWidth="14"
        strokeLinecap="round"
      />
      <circle cx="120" cy="420" r="22" fill="#047857" />
      <circle cx="240" cy="280" r="18" fill="#34D399" />
      <circle cx="384" cy="150" r="26" fill="#F59E0B" />
      <path d="M384 150 L384 96 L420 110 L384 124 Z" fill="#D97706" />
    </svg>
  );
}
