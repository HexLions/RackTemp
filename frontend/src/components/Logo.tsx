export default function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="RackTemp">
      <rect width="64" height="64" rx="14" fill="#0E1214" />
      <rect x="9" y="13" width="28" height="9" rx="3" fill="#2A3338" />
      <rect x="9" y="28" width="28" height="9" rx="3" fill="#2A3338" />
      <rect x="9" y="43" width="46" height="9" rx="3" fill="#2A3338" />
      <circle cx="31" cy="17.5" r="2" fill="#5A676D" />
      <circle cx="31" cy="32.5" r="2" fill="#F0B429" />
      <rect x="43" y="11" width="7" height="17" rx="3.5" fill="#2FD07A" />
      <circle cx="46.5" cy="31" r="7.5" fill="#2FD07A" />
    </svg>
  );
}
