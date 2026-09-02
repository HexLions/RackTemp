import { Router } from "express";
import { ah } from "../middleware/asyncHandler";
import { randomBytes } from "crypto";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth } from "../middleware/auth";

export const integrationsRouter = Router();
integrationsRouter.use(ah(requireAuth));

async function getSettings() {
  return prisma.integrationSettings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, prtgToken: randomBytes(32).toString("hex") },
  });
}

integrationsRouter.get("/", ah(async (_req, res) => {
  const settings = await getSettings();
  res.json({ prtgToken: settings.prtgToken, portainerWebhookUrl: settings.portainerWebhookUrl });
}));

// This URL gets POSTed to from the server itself (/api/system/trigger-update)
// with no further checks — an admin-only SSRF primitive otherwise. Restrict
// to http/https (no file:, data:, gopher:, ...) and reject the obvious
// internal/metadata targets. Doesn't chase DNS rebinding (a hostname that
// resolves to a link-local address only at request time) — that needs a
// request-time check against the resolved IP, out of scope for what was
// asked here; this catches the URL being link-local/metadata on its face.
function isBlockedWebhookHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h === "169.254.169.254") return true;
  if (/^127\./.test(h) || /^169\.254\./.test(h)) return true;
  if (h === "::1" || h === "[::1]") return true;
  return false;
}

const webhookSchema = z.object({
  portainerWebhookUrl: z
    .string()
    .url()
    .refine((v) => ["http:", "https:"].includes(new URL(v).protocol), {
      message: "webhook URL must be http or https",
    })
    .refine((v) => !isBlockedWebhookHost(new URL(v).hostname), {
      message: "webhook URL points to a link-local/metadata address",
    })
    .nullable(),
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
  const prtgToken = randomBytes(32).toString("hex");
  const updated = await prisma.integrationSettings.update({
    where: { id: 1 },
    data: { prtgToken },
  });
  res.json({ prtgToken: updated.prtgToken });
}));
