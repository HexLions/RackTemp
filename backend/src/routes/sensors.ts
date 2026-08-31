import { Router } from "express";
import { ah } from "../middleware/asyncHandler";
import { randomBytes } from "crypto";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, requireAnyUser } from "../middleware/auth";
import { logAudit } from "../services/auditLog";

export const sensorsRouter = Router();
// Read routes are open to both roles (requireAnyUser); every mutating route
// below adds ah(requireAuth) on top of this, admin-only - see the
// role/apiKey comments on those routes and on redactForViewer() below.
sensorsRouter.use(ah(requireAnyUser));

// How long /api/discovery/announce will hand back a linked sensor's API key
// for. Opened by an admin action (creating/claiming with a chipId, or
// POST /:id/reopen-handoff) — see discovery.ts for the consuming side.
export const KEY_HANDOUT_WINDOW_MS = 10 * 60_000;

// apiKey is real credential material (whoever has it can POST readings as
// that sensor) - a read-only viewer seeing the dashboard must not be able to
// read it out, including straight from this JSON via curl/devtools, not
// just "hidden" in the UI. Everything else on a sensor (name, location,
// thresholds, readings) is fine for a viewer to see as-is.
function redactForViewer<T extends { apiKey: string }>(sensor: T, role: string): Omit<T, "apiKey"> | T {
  if (role !== "viewer") return sensor;
  const { apiKey: _apiKey, ...rest } = sensor;
  return rest;
}

sensorsRouter.get("/", ah(async (req, res) => {
  const sensors = await prisma.sensor.findMany({
    include: {
      threshold: true,
      readings: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { createdAt: "asc" },
  });
  const role = (req.session as any)?.role;
  res.json(sensors.map((s) => redactForViewer(s, role)));
}));

// max(80): this ends up as a Prometheus label value (metrics.ts) and a
// PRTG channel/device name (prtg.ts) — unbounded lets one sensor bloat
// every scrape and every PRTG payload.
const createSchema = z.object({
  name: z.string().min(1).max(80),
  location: z.string().optional(),
  staticIp: z.string().optional(),
  // Set when created from a discovery banner entry ("Configura"): links the
  // new sensor to that chip immediately, so the device picks up its API key
  // on its next announce poll without any extra step.
  chipId: z.string().optional(),
});

sensorsRouter.post("/", ah(requireAuth), ah(async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid body" });

  const sensor = await prisma.sensor.create({
    data: {
      name: parsed.data.name,
      location: parsed.data.location,
      staticIp: parsed.data.staticIp,
      chipId: parsed.data.chipId,
      apiKey: randomBytes(32).toString("hex"),
      threshold: { create: {} },
      ...(parsed.data.chipId
        ? { keyHandoutUntil: new Date(Date.now() + KEY_HANDOUT_WINDOW_MS), keyHandedOut: false }
        : {}),
    },
    include: { threshold: true },
  });

  if (parsed.data.chipId) {
    await prisma.discoveredDevice.deleteMany({ where: { chipId: parsed.data.chipId } });
  }

  res.status(201).json(sensor);
}));

// Express 5 / path-to-regexp 8 widened req.params values to `string |
// string[]` (a wildcard `*name` param can capture multiple segments); every
// route in this file uses a plain `:id`, never a wildcard, so it's always a
// single string at runtime — `as string` throughout just tells Prisma that.
sensorsRouter.get("/:id", ah(async (req, res) => {
  const sensor = await prisma.sensor.findUnique({
    where: { id: req.params.id as string },
    include: { threshold: true },
  });
  if (!sensor) return res.status(404).json({ error: "not found" });
  res.json(redactForViewer(sensor, (req.session as any)?.role));
}));

const updateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  location: z.string().optional().nullable(),
  staticIp: z.string().optional().nullable(),
});

sensorsRouter.put("/:id", ah(requireAuth), ah(async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid body" });

  const sensor = await prisma.sensor.update({
    where: { id: req.params.id as string },
    data: parsed.data,
  });
  res.json(sensor);
}));

sensorsRouter.delete("/:id", ah(requireAuth), ah(async (req, res) => {
  const id = req.params.id as string;
  await prisma.sensor.delete({ where: { id } });
  await logAudit("sensor_deleted", { detail: `sensor id: ${id}`, ip: req.ip });
  res.status(204).end();
}));

sensorsRouter.post("/:id/regenerate-key", ah(requireAuth), ah(async (req, res) => {
  const apiKey = randomBytes(32).toString("hex");
  const sensor = await prisma.sensor.update({
    where: { id: req.params.id as string },
    data: { apiKey },
  });
  await logAudit("sensor_key_regenerated", { detail: `sensor: ${sensor.name} (${sensor.id})`, ip: req.ip });
  res.json(sensor);
}));

// For when the first pairing window (opened at create/claim time) closed
// before the device actually picked up its key — e.g. it wasn't powered on
// yet, or the WiFi/server address in the setup portal was wrong the first
// time. Reopens the same 10-minute one-shot handoff.
sensorsRouter.post("/:id/reopen-handoff", ah(requireAuth), ah(async (req, res) => {
  const sensor = await prisma.sensor.update({
    where: { id: req.params.id as string },
    data: { keyHandoutUntil: new Date(Date.now() + KEY_HANDOUT_WINDOW_MS), keyHandedOut: false },
  });
  res.json({ keyHandoutUntil: sensor.keyHandoutUntil });
}));

// The sensor has no open connection to push a command to — it only talks to
// us when it POSTs a reading (every SEND_INTERVAL_SEC). So this just sets a
// flag; the actual reboot happens the next time /api/ingest sees it and
// answers with {reboot:true}, which can take up to ~1 minute.
sensorsRouter.post("/:id/reboot", ah(requireAuth), ah(async (req, res) => {
  const sensor = await prisma.sensor.update({
    where: { id: req.params.id as string },
    data: { rebootRequested: true },
  });
  res.json(sensor);
}));

sensorsRouter.get("/:id/readings", ah(async (req, res) => {
  const hours = Math.min(Number(req.query.hours) || 24, 24 * 30);
  const since = new Date(Date.now() - hours * 3600_000);
  const readings = await prisma.reading.findMany({
    where: { sensorId: req.params.id as string, createdAt: { gte: since } },
    orderBy: { createdAt: "asc" },
  });
  res.json(readings);
}));

sensorsRouter.get("/:id/readings.csv", ah(async (req, res) => {
  const sensor = await prisma.sensor.findUnique({ where: { id: req.params.id as string } });
  if (!sensor) return res.status(404).json({ error: "not found" });

  const hours = Math.min(Number(req.query.hours) || 24 * 30, 24 * 365);
  const since = new Date(Date.now() - hours * 3600_000);
  const readings = await prisma.reading.findMany({
    where: { sensorId: req.params.id as string, createdAt: { gte: since } },
    orderBy: { createdAt: "asc" },
  });

  const rows = ["timestamp,temperature_c,humidity_pct,rssi_dbm"];
  for (const r of readings) {
    rows.push([r.createdAt.toISOString(), r.temperature, r.humidity ?? "", r.rssi ?? ""].join(","));
  }

  const safeName = sensor.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${safeName}-readings.csv"`);
  res.send(rows.join("\n"));
}));

const thresholdSchema = z.object({
  minTemp: z.number().nullable().optional(),
  maxTemp: z.number().nullable().optional(),
  minHumidity: z.number().nullable().optional(),
  maxHumidity: z.number().nullable().optional(),
  maxOfflineMin: z.number().int().positive().optional(),
  hysteresis: z.number().min(0).optional(),
  cooldownMin: z.number().int().positive().optional(),
  enabled: z.boolean().optional(),
  mutedUntil: z.coerce.date().nullable().optional(),
});

sensorsRouter.put("/:id/threshold", ah(requireAuth), ah(async (req, res) => {
  const parsed = thresholdSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid body" });

  const threshold = await prisma.threshold.upsert({
    where: { sensorId: req.params.id as string },
    update: parsed.data,
    create: { sensorId: req.params.id as string, ...parsed.data },
  });
  res.json(threshold);
}));
