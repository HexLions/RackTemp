import { Router } from "express";
import { ah } from "../middleware/asyncHandler";
import { z } from "zod";
import { prisma } from "../db";
import { checkReading } from "../services/thresholdEngine";
import { broadcastReading } from "../ws";
import { syncSensorRow } from "../services/snmpAgent";

export const ingestRouter = Router();

const ingestSchema = z.object({
  temperature: z.number(),
  humidity: z.number().optional(),
  rssi: z.number().int().optional(),
  chipId: z.string().optional(),
  firmwareVersion: z.string().optional(),
});

ingestRouter.post("/", ah(async (req, res) => {
  // Header only — a query-string fallback would put the credential in every
  // reverse proxy's access log. The firmware always sends X-Api-Key already;
  // unlike /api/prtg/* and /api/status/*, nothing needs this in a URL (PRTG
  // and monitoring tools are the reason those two keep the query-string form).
  const apiKey = req.header("X-Api-Key");
  if (!apiKey) return res.status(401).json({ error: "missing api key" });

  const sensor = await prisma.sensor.findUnique({ where: { apiKey } });
  if (!sensor) return res.status(401).json({ error: "invalid api key" });

  const parsed = ingestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid body" });

  const { chipId, firmwareVersion, ...readingData } = parsed.data;

  const reading = await prisma.reading.create({
    data: { sensorId: sensor.id, ...readingData },
  });
  await prisma.sensor.update({
    where: { id: sensor.id },
    data: {
      lastSeenAt: new Date(),
      ...(firmwareVersion ? { firmwareVersion } : {}),
    },
  });

  // Device is now sending authenticated readings — it no longer belongs in
  // the "seen but not configured" discovery list.
  if (chipId) {
    await prisma.discoveredDevice.deleteMany({ where: { chipId } });

    if (!sensor.chipId) {
      await prisma.sensor.update({ where: { id: sensor.id }, data: { chipId } }).catch(() => {});
    }
  }

  broadcastReading(sensor.id, reading);
  await checkReading(sensor.id, readingData.temperature, readingData.humidity);
  // First line is `if (!agent) return` (services/snmpAgent.ts) - near-zero
  // cost added to this hot path (every sensor, every ~60s) when SNMP is
  // disabled, which it is by default.
  await syncSensorRow(sensor.id);

  // One-shot: the firmware reboots as soon as it sees this and there's no
  // separate ack, so clear it here rather than waiting to hear back —
  // worst case (response lost in transit) is one missed reboot, not a
  // crash loop.
  let reboot = false;
  if (sensor.rebootRequested) {
    reboot = true;
    await prisma.sensor.update({ where: { id: sensor.id }, data: { rebootRequested: false } });
  }

  res.status(201).json({ ok: true, reboot });
}));
