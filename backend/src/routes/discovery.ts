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

// Called by ESP32 firmware on boot (and periodically while unclaimed), no
// auth: the device doesn't have an API key yet at this point. Any client on
// the network can technically ping this, but all it does is add a row to a
// "seen on the network" list an admin has to act on — it can't read or
// change anything.
discoveryRouter.post("/announce", async (req, res) => {
  const parsed = announceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid body" });

  const { chipId, firmware } = parsed.data;
  const ip = req.header("x-forwarded-for")?.split(",")[0].trim() || req.socket.remoteAddress || undefined;

  const existing = await prisma.discoveredDevice.findUnique({ where: { chipId } });
  await prisma.discoveredDevice.upsert({
    where: { chipId },
    update: { ip, firmware },
    create: { chipId, ip, firmware },
  });

  if (!existing) {
    await notifyAll(
      "Rack Temp Monitor - nuovo sensore rilevato",
      `Rilevato un nuovo ESP32 sulla rete (chip ${chipId}${ip ? `, IP ${ip}` : ""}). Crea un sensore nella dashboard e flasha la sua API key sul dispositivo per collegarlo.`
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
