import { useEffect, useState } from "react";
import { LineChart, Line, ResponsiveContainer } from "recharts";
import { api, Reading } from "../api/client";

export default function Sparkline({ sensorId, color }: { sensorId: string; color: string }) {
  const [points, setPoints] = useState<Reading[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<Reading[]>(`/sensors/${sensorId}/readings?hours=3`)
      .then((r) => !cancelled && setPoints(r))
      .catch(() => !cancelled && setPoints([]));
    return () => {
      cancelled = true;
    };
  }, [sensorId]);

  if (!points || points.length < 2) return null;

  return (
    <div className="sparkline">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points}>
          <Line type="monotone" dataKey="temperature" stroke={color} strokeWidth={1.6} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
