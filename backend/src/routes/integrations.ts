import { Router } from "express";
import { ah } from "../middleware/asyncHandler";
import { randomBytes } from "crypto";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth } from "../middleware/auth";
import { startSnmpAgent, stopSnmpAgent } from "../services/snmpAgent";

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
  res.json({
    prtgToken: settings.prtgToken,
    portainerWebhookUrl: settings.portainerWebhookUrl,
    snmpEnabled: settings.snmpEnabled,
    snmpPort: settings.snmpPort,
    snmpCommunity: settings.snmpCommunity,
  });
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

const snmpSchema = z.object({
  snmpEnabled: z.boolean(),
  snmpPort: z.number().int().min(1).max(65535),
});

// Turning SNMP on/off (or changing its port) takes effect immediately, no
// restart needed - same "live" UX as regenerate-prtg-token above, just
// with an actual running agent to start/stop/restart instead of a value
// to hand back. Community string is generated here the first time SNMP
// is enabled with none set yet, same randomBytes(32) pattern as
// prtgToken - never blank once SNMP has ever been turned on.
integrationsRouter.put("/snmp", ah(async (req, res) => {
  const parsed = snmpSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

  const current = await getSettings();
  const snmpCommunity = current.snmpCommunity ?? randomBytes(16).toString("hex");

  const updated = await prisma.integrationSettings.update({
    where: { id: 1 },
    data: { snmpEnabled: parsed.data.snmpEnabled, snmpPort: parsed.data.snmpPort, snmpCommunity },
  });

  stopSnmpAgent();
  if (updated.snmpEnabled) {
    await startSnmpAgent(updated.snmpPort, updated.snmpCommunity!);
  }

  res.json({ snmpEnabled: updated.snmpEnabled, snmpPort: updated.snmpPort, snmpCommunity: updated.snmpCommunity });
}));

integrationsRouter.post("/regenerate-snmp-community", ah(async (_req, res) => {
  const current = await getSettings();
  const snmpCommunity = randomBytes(16).toString("hex");
  const updated = await prisma.integrationSettings.update({ where: { id: 1 }, data: { snmpCommunity } });

  // Live-restart with the new community if the agent's currently running,
  // same "regenerate and it's live immediately" contract as /snmp above.
  if (current.snmpEnabled) {
    stopSnmpAgent();
    await startSnmpAgent(updated.snmpPort, updated.snmpCommunity!);
  }

  res.json({ snmpCommunity: updated.snmpCommunity });
}));
