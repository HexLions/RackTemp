export default function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="2" y="3" width="20" height="18" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <line x1="2" y1="9" x2="22" y2="9" stroke="currentColor" strokeWidth="1.6" />
      <line x1="2" y1="15" x2="22" y2="15" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="6" cy="6" r="1.1" fill="currentColor" />
      <circle cx="6" cy="12" r="1.1" fill="currentColor" />
      <circle cx="6" cy="18" r="1.1" fill="var(--ok)" />
    </svg>
  );
}
