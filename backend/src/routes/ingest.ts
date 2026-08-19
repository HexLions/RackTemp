import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { checkReading } from "../services/thresholdEngine";
import { broadcastReading } from "../ws";

export const ingestRouter = Router();

const ingestSchema = z.object({
  temperature: z.number(),
  humidity: z.number().optional(),
  rssi: z.number().int().optional(),
});

ingestRouter.post("/", async (req, res) => {
  const apiKey = req.header("X-Api-Key") ?? (req.query.apiKey as string | undefined);
  if (!apiKey) return res.status(401).json({ error: "missing api key" });

  const sensor = await prisma.sensor.findUnique({ where: { apiKey } });
  if (!sensor) return res.status(401).json({ error: "invalid api key" });

  const parsed = ingestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid body" });

  const reading = await prisma.reading.create({
    data: { sensorId: sensor.id, ...parsed.data },
  });
  await prisma.sensor.update({
    where: { id: sensor.id },
    data: { lastSeenAt: new Date() },
  });

  broadcastReading(sensor.id, reading);
  await checkReading(sensor.id, parsed.data.temperature);

  res.status(201).json({ ok: true });
});
