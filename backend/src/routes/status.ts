import { Router } from "express";
import { ah } from "../middleware/asyncHandler";
import { prisma } from "../db";
import { secretEquals } from "../services/secrets";

export const statusRouter = Router();

// Plain JSON per sensor, for monitoring tools that read arbitrary JSON
// instead of expecting PRTG's specific shape — Zabbix (HTTP agent item +
// JSON preprocessing), Uptime Kuma (JSON Query monitor), Home Assistant
// (REST sensor), Node-RED, or anything else that can GET+parse JSON. Same
// per-sensor apiKey auth as the legacy PRTG endpoint.
statusRouter.get("/:sensorId", ah(async (req, res) => {
  const sensor = await prisma.sensor.findUnique({
    where: { id: req.params.sensorId },
    include: { threshold: true },
  });
  const key = req.query.key as string | undefined;

  if (!sensor || !secretEquals(sensor.apiKey, key)) {
    return res.status(401).json({ error: "invalid sensor or key" });
  }

  const reading = await prisma.reading.findFirst({
    where: { sensorId: sensor.id },
    orderBy: { createdAt: "desc" },
  });

  const maxOfflineMin = sensor.threshold?.maxOfflineMin ?? 15;
  const online = !!sensor.lastSeenAt && Date.now() - sensor.lastSeenAt.getTime() <= maxOfflineMin * 60_000;

  res.json({
    sensor: sensor.name,
    location: sensor.location,
    online,
    lastSeenAt: sensor.lastSeenAt,
    firmwareVersion: sensor.firmwareVersion,
    temperature: reading?.temperature ?? null,
    humidity: reading?.humidity ?? null,
    rssi: reading?.rssi ?? null,
    readingAt: reading?.createdAt ?? null,
  });
}));
