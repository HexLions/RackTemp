import { Router } from "express";
import { prisma } from "../db";

export const metricsRouter = Router();

function esc(v: string) {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

// Standard Prometheus exposition format — scrapeable directly by
// Prometheus/Grafana, and by most other monitoring tools (Zabbix, Uptime
// Kuma, ...) that can pull a Prometheus endpoint. Unauthenticated, matching
// convention (e.g. node_exporter): put it behind a reverse proxy with an
// IP allowlist if this instance is reachable beyond a trusted LAN.
metricsRouter.get("/", async (_req, res) => {
  const sensors = await prisma.sensor.findMany({
    include: {
      threshold: true,
      readings: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  const lines: string[] = [];

  lines.push("# HELP rack_temp_celsius Latest temperature reading, in Celsius.");
  lines.push("# TYPE rack_temp_celsius gauge");
  lines.push("# HELP rack_temp_humidity_percent Latest humidity reading, in percent.");
  lines.push("# TYPE rack_temp_humidity_percent gauge");
  lines.push("# HELP rack_temp_last_seen_seconds Seconds since the last reading was received.");
  lines.push("# TYPE rack_temp_last_seen_seconds gauge");
  lines.push("# HELP rack_temp_threshold_min_celsius Configured minimum temperature threshold.");
  lines.push("# TYPE rack_temp_threshold_min_celsius gauge");
  lines.push("# HELP rack_temp_threshold_max_celsius Configured maximum temperature threshold.");
  lines.push("# TYPE rack_temp_threshold_max_celsius gauge");
  lines.push("# HELP rack_temp_online Whether the sensor is within its configured offline timeout (1) or not (0).");
  lines.push("# TYPE rack_temp_online gauge");

  for (const s of sensors) {
    const labels = `sensor_id="${esc(s.id)}",sensor="${esc(s.name)}",location="${esc(s.location ?? "")}"`;
    const reading = s.readings[0];

    if (reading) {
      lines.push(`rack_temp_celsius{${labels}} ${reading.temperature}`);
      if (reading.humidity != null) {
        lines.push(`rack_temp_humidity_percent{${labels}} ${reading.humidity}`);
      }
    }

    if (s.lastSeenAt) {
      const ageSec = Math.round((Date.now() - s.lastSeenAt.getTime()) / 1000);
      lines.push(`rack_temp_last_seen_seconds{${labels}} ${ageSec}`);
      const online = s.threshold && ageSec > s.threshold.maxOfflineMin * 60 ? 0 : 1;
      lines.push(`rack_temp_online{${labels}} ${online}`);
    } else {
      lines.push(`rack_temp_online{${labels}} 0`);
    }

    if (s.threshold?.minTemp != null) {
      lines.push(`rack_temp_threshold_min_celsius{${labels}} ${s.threshold.minTemp}`);
    }
    if (s.threshold?.maxTemp != null) {
      lines.push(`rack_temp_threshold_max_celsius{${labels}} ${s.threshold.maxTemp}`);
    }
  }

  res.set("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
  res.send(lines.join("\n") + "\n");
});
