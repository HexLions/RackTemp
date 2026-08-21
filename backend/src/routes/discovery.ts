import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth } from "../middleware/auth";
import { notifyAll } from "../services/notifier";

export const discoveryRouter = Router();

const ACTIVE_WINDOW_MS = 10 * 60_000;

const announceSchema = z.object({
  chipId: z.string().min(1),
  firmware: z.string().optional(),
});

// Called by ESP32/ESP8266 firmware on boot, and repeatedly on every loop
// cycle while it has no API key, no auth: the device doesn't have one yet
// at this point. Any client on the network can technically ping this, but
// all it does is add a row to a "seen on the network" list an admin has to
// act on — it can't read or change anything, UNLESS an admin has already
// linked this exact chipId to a Sensor (via /claim, or by creating the
// sensor from this device's discovery entry), in which case the device's
// own next poll is handed that sensor's API key so it can start sending
// data without ever being touched again — no reflashing, no re-opening the
// setup portal.
discoveryRouter.post("/announce", async (req, res) => {
  const parsed = announceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid body" });

  const { chipId, firmware } = parsed.data;
  const ip = req.header("x-forwarded-for")?.split(",")[0].trim() || req.socket.remoteAddress || undefined;

  const linkedSensor = await prisma.sensor.findUnique({ where: { chipId } });
  if (linkedSensor) {
    await prisma.discoveredDevice.deleteMany({ where: { chipId } });
    return res.json({ apiKey: linkedSensor.apiKey });
  }

  const existing = await prisma.discoveredDevice.findUnique({ where: { chipId } });
  await prisma.discoveredDevice.upsert({
    where: { chipId },
    update: { ip, firmware },
    create: { chipId, ip, firmware },
  });

  if (!existing) {
    await notifyAll(
      "Rack Temp Monitor - new sensor detected",
      `A new ESP32 was detected on the network (chip ${chipId}${ip ? `, IP ${ip}` : ""}). Create a sensor in the dashboard and link it to get it started automatically.`
    );
  }

  res.status(204).end();
});

discoveryRouter.get("/", requireAuth, async (_req, res) => {
  const since = new Date(Date.now() - ACTIVE_WINDOW_MS);
  const devices = await prisma.discoveredDevice.findMany({
    where: { lastSeenAt: { gte: since } },
    orderBy: { firstSeenAt: "desc" },
  });
  res.json(devices);
});

discoveryRouter.delete("/:id", requireAuth, async (req, res) => {
  await prisma.discoveredDevice.deleteMany({ where: { id: req.params.id } });
  res.status(204).end();
});

const claimSchema = z.object({ sensorId: z.string().min(1) });

// Links an already-existing Sensor (e.g. one created directly from the
// dashboard, not from this discovery entry) to a device that's still
// polling /announce for a key. The device picks the key up on its next
// poll — no manual copy-paste, no re-opening the setup portal.
discoveryRouter.post("/:id/claim", requireAuth, async (req, res) => {
  const parsed = claimSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid body" });

  const device = await prisma.discoveredDevice.findUnique({ where: { id: req.params.id } });
  if (!device) return res.status(404).json({ error: "device not found" });

  try {
    const sensor = await prisma.sensor.update({
      where: { id: parsed.data.sensorId },
      data: { chipId: device.chipId },
    });
    await prisma.discoveredDevice.delete({ where: { id: device.id } });
    res.json(sensor);
  } catch {
    res.status(409).json({ error: "sensor not found or already linked to another chip" });
  }
});
