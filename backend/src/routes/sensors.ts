import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth } from "../middleware/auth";

export const sensorsRouter = Router();
sensorsRouter.use(requireAuth);

sensorsRouter.get("/", async (_req, res) => {
  const sensors = await prisma.sensor.findMany({
    include: {
      threshold: true,
      readings: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { createdAt: "asc" },
  });
  res.json(sensors);
});

const createSchema = z.object({
  name: z.string().min(1),
  location: z.string().optional(),
  staticIp: z.string().optional(),
  // Set when created from a discovery banner entry ("Configura"): links the
  // new sensor to that chip immediately, so the device picks up its API key
  // on its next announce poll without any extra step.
  chipId: z.string().optional(),
});

sensorsRouter.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid body" });

  const sensor = await prisma.sensor.create({
    data: {
      name: parsed.data.name,
      location: parsed.data.location,
      staticIp: parsed.data.staticIp,
      chipId: parsed.data.chipId,
      threshold: { create: {} },
    },
    include: { threshold: true },
  });

  if (parsed.data.chipId) {
    await prisma.discoveredDevice.deleteMany({ where: { chipId: parsed.data.chipId } });
  }

  res.status(201).json(sensor);
});

sensorsRouter.get("/:id", async (req, res) => {
  const sensor = await prisma.sensor.findUnique({
    where: { id: req.params.id },
    include: { threshold: true },
  });
  if (!sensor) return res.status(404).json({ error: "not found" });
  res.json(sensor);
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  location: z.string().optional().nullable(),
  staticIp: z.string().optional().nullable(),
});

sensorsRouter.put("/:id", async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid body" });

  const sensor = await prisma.sensor.update({
    where: { id: req.params.id },
    data: parsed.data,
  });
  res.json(sensor);
});

sensorsRouter.delete("/:id", async (req, res) => {
  await prisma.sensor.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

sensorsRouter.post("/:id/regenerate-key", async (req, res) => {
  const { randomBytes } = await import("crypto");
  const apiKey = randomBytes(16).toString("hex");
  const sensor = await prisma.sensor.update({
    where: { id: req.params.id },
    data: { apiKey },
  });
  res.json(sensor);
});

sensorsRouter.get("/:id/readings", async (req, res) => {
  const hours = Math.min(Number(req.query.hours) || 24, 24 * 30);
  const since = new Date(Date.now() - hours * 3600_000);
  const readings = await prisma.reading.findMany({
    where: { sensorId: req.params.id, createdAt: { gte: since } },
    orderBy: { createdAt: "asc" },
  });
  res.json(readings);
});

const thresholdSchema = z.object({
  minTemp: z.number().nullable().optional(),
  maxTemp: z.number().nullable().optional(),
  minHumidity: z.number().nullable().optional(),
  maxHumidity: z.number().nullable().optional(),
  maxOfflineMin: z.number().int().positive().optional(),
  hysteresis: z.number().min(0).optional(),
  cooldownMin: z.number().int().positive().optional(),
  enabled: z.boolean().optional(),
});

sensorsRouter.put("/:id/threshold", async (req, res) => {
  const parsed = thresholdSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid body" });

  const threshold = await prisma.threshold.upsert({
    where: { sensorId: req.params.id },
    update: parsed.data,
    create: { sensorId: req.params.id, ...parsed.data },
  });
  res.json(threshold);
});
