import { Router } from "express";
import { randomBytes } from "crypto";
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

integrationsRouter.get("/", async (_req, res) => {
  const settings = await getSettings();
  res.json({ prtgToken: settings.prtgToken });
});

integrationsRouter.post("/regenerate-prtg-token", async (_req, res) => {
  await getSettings();
  const prtgToken = randomBytes(16).toString("hex");
  const updated = await prisma.integrationSettings.update({
    where: { id: 1 },
    data: { prtgToken },
  });
  res.json({ prtgToken: updated.prtgToken });
});
