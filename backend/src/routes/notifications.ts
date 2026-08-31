import { Router } from "express";
import { ah } from "../middleware/asyncHandler";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth } from "../middleware/auth";
import { sendTestEmail, sendTelegram } from "../services/notifier";
import { encryptField, decryptField } from "../services/fieldEncryption";

export const notificationsRouter = Router();
notificationsRouter.use(ah(requireAuth));

function mask(secret: string | null | undefined) {
  if (!secret) return null;
  return secret.length <= 4 ? "****" : `${secret.slice(0, 2)}****${secret.slice(-2)}`;
}

notificationsRouter.get("/config", ah(async (_req, res) => {
  const cfg = await prisma.notificationConfig.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });
  res.json({
    ...cfg,
    smtpPass: mask(decryptField(cfg.smtpPass)),
    telegramToken: mask(decryptField(cfg.telegramToken)),
    graphClientSecret: mask(decryptField(cfg.graphClientSecret)),
  });
}));

const configSchema = z.object({
  smtpEnabled: z.boolean().optional(),
  smtpHost: z.string().optional().nullable(),
  smtpPort: z.number().int().optional().nullable(),
  smtpSecure: z.boolean().optional(),
  smtpUser: z.string().optional().nullable(),
  smtpPass: z.string().optional().nullable(),
  smtpFrom: z.string().optional().nullable(),
  smtpTo: z.string().optional().nullable(),
  emailProvider: z.enum(["smtp", "graph"]).optional(),
  graphTenantId: z.string().optional().nullable(),
  graphClientId: z.string().optional().nullable(),
  graphClientSecret: z.string().optional().nullable(),
  graphSenderEmail: z.string().optional().nullable(),
  telegramEnabled: z.boolean().optional(),
  telegramToken: z.string().optional().nullable(),
  telegramChatId: z.string().optional().nullable(),
});

notificationsRouter.put("/config", ah(async (req, res) => {
  const parsed = configSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid body" });

  // Don't overwrite secrets with the masked placeholder sent back to the UI.
  const data = { ...parsed.data };
  if (data.smtpPass?.includes("****")) delete data.smtpPass;
  if (data.telegramToken?.includes("****")) delete data.telegramToken;
  if (data.graphClientSecret?.includes("****")) delete data.graphClientSecret;

  // Encrypt at rest — a real value replacing the field re-encrypts it (this
  // is also how a pre-encryption install's plaintext row self-heals: the
  // next time each secret is actually changed, it's saved back encrypted).
  if (data.smtpPass) data.smtpPass = encryptField(data.smtpPass);
  if (data.telegramToken) data.telegramToken = encryptField(data.telegramToken);
  if (data.graphClientSecret) data.graphClientSecret = encryptField(data.graphClientSecret);

  const cfg = await prisma.notificationConfig.upsert({
    where: { id: 1 },
    update: data,
    create: { id: 1, ...data },
  });
  res.json({
    ...cfg,
    smtpPass: mask(decryptField(cfg.smtpPass)),
    telegramToken: mask(decryptField(cfg.telegramToken)),
    graphClientSecret: mask(decryptField(cfg.graphClientSecret)),
  });
}));

notificationsRouter.get("/log", ah(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const logs = await prisma.notificationLog.findMany({
    orderBy: { sentAt: "desc" },
    take: limit,
    include: { sensor: { select: { name: true } } },
  });
  res.json(logs);
}));

const testSchema = z.object({ channel: z.enum(["smtp", "telegram"]) });

notificationsRouter.post("/test", ah(async (req, res) => {
  const parsed = testSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid body" });

  try {
    if (parsed.data.channel === "smtp") {
      const detail = await sendTestEmail();
      res.json({ ok: true, detail });
    } else {
      await sendTelegram("Rack Temp Monitor - Telegram test message succeeded.");
      res.json({ ok: true });
    }
  } catch (err: any) {
    res.status(500).json({ error: describeSendError(err) });
  }
}));

// The raw OpenSSL/Node TLS error ("wrong version number") is the #1 SMTP
// support question there is: it means the port and the "TLS/SSL from the
// start" checkbox don't match (465 needs it checked, 587/25 need it
// unchecked - STARTTLS, negotiated a moment after connecting, not from
// the first byte) - translating it here means the fix shows up right in
// the test-button error instead of sending the admin off to decode an
// OpenSSL error string by hand.
function describeSendError(err: any): string {
  const message = err?.message ?? "send failed";
  if (typeof message === "string" && /wrong version number/i.test(message)) {
    return (
      "TLS error - the port and the \"TLS/SSL from the start\" checkbox don't match. " +
      "Port 465 needs the box checked; port 587 or 25 need it unchecked (STARTTLS). " +
      `Original error: ${message}`
    );
  }
  return message;
}
