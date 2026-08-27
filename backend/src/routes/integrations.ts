import { Router } from "express";
import { ah } from "../middleware/asyncHandler";
import { randomBytes } from "crypto";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth } from "../middleware/auth";

export const integrationsRouter = Router();
integrationsRouter.use(requireAuth);

async function getSettings() {
  return prisma.integrationSettings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });
}

integrationsRouter.get("/", ah(async (_req, res) => {
  const settings = await getSettings();
  res.json({ prtgToken: settings.prtgToken, portainerWebhookUrl: settings.portainerWebhookUrl });
}));

const webhookSchema = z.object({
  portainerWebhookUrl: z.string().url().nullable(),
});

integrationsRouter.put("/portainer-webhook", ah(async (req, res) => {
  const parsed = webhookSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  await getSettings();
  const updated = await prisma.integrationSettings.update({
    where: { id: 1 },
    data: { portainerWebhookUrl: parsed.data.portainerWebhookUrl },
  });
  res.json({ prtgToken: updated.prtgToken, portainerWebhookUrl: updated.portainerWebhookUrl });
}));

integrationsRouter.post("/regenerate-prtg-token", ah(async (_req, res) => {
  await getSettings();
  const prtgToken = randomBytes(16).toString("hex");
  const updated = await prisma.integrationSettings.update({
    where: { id: 1 },
    data: { prtgToken },
  });
  res.json({ prtgToken: updated.prtgToken });
}));
