// RSSI (dBm) -> 4-bar signal icon, same rough thresholds phones use:
// >= -50 excellent, >= -60 good, >= -70 fair, >= -80 weak, below that unusable.
function levelOf(rssi: number): 0 | 1 | 2 | 3 | 4 {
  if (rssi >= -50) return 4;
  if (rssi >= -60) return 3;
  if (rssi >= -70) return 2;
  if (rssi >= -80) return 1;
  return 0;
}

const BAR_HEIGHTS = [5, 8, 11, 14];

export default function WifiSignalIcon({ rssi, size = 16, showLabel = false }: { rssi: number; size?: number; showLabel?: boolean }) {
  const level = levelOf(rssi);
  return (
    <span className="row-actions" style={{ gap: 3 }}>
      <svg width={size} height={size} viewBox="0 0 18 14" aria-hidden="true">
        {BAR_HEIGHTS.map((h, i) => (
          <rect
            key={i}
            x={i * 4.5}
            y={14 - h}
            width={3}
            height={h}
            rx={0.8}
            fill={i < level ? "var(--ok)" : "var(--line-strong)"}
          />
        ))}
      </svg>
      {showLabel && <span>{rssi} dBm</span>}
    </span>
  );
}
