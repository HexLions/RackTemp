import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth } from "../middleware/auth";
import { sendEmail, sendTelegram } from "../services/notifier";

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

function mask(secret: string | null | undefined) {
  if (!secret) return null;
  return secret.length <= 4 ? "****" : `${secret.slice(0, 2)}****${secret.slice(-2)}`;
}

notificationsRouter.get("/config", async (_req, res) => {
  const cfg = await prisma.notificationConfig.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });
  res.json({
    ...cfg,
    smtpPass: mask(cfg.smtpPass),
    telegramToken: mask(cfg.telegramToken),
  });
});

const configSchema = z.object({
  smtpEnabled: z.boolean().optional(),
  smtpHost: z.string().optional().nullable(),
  smtpPort: z.number().int().optional().nullable(),
  smtpSecure: z.boolean().optional(),
  smtpUser: z.string().optional().nullable(),
  smtpPass: z.string().optional().nullable(),
  smtpFrom: z.string().optional().nullable(),
  smtpTo: z.string().optional().nullable(),
  telegramEnabled: z.boolean().optional(),
  telegramToken: z.string().optional().nullable(),
  telegramChatId: z.string().optional().nullable(),
});

notificationsRouter.put("/config", async (req, res) => {
  const parsed = configSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid body" });

  // Don't overwrite secrets with the masked placeholder sent back to the UI.
  const data = { ...parsed.data };
  if (data.smtpPass?.includes("****")) delete data.smtpPass;
  if (data.telegramToken?.includes("****")) delete data.telegramToken;

  const cfg = await prisma.notificationConfig.upsert({
    where: { id: 1 },
    update: data,
    create: { id: 1, ...data },
  });
  res.json({ ...cfg, smtpPass: mask(cfg.smtpPass), telegramToken: mask(cfg.telegramToken) });
});

const testSchema = z.object({ channel: z.enum(["smtp", "telegram"]) });

notificationsRouter.post("/test", async (req, res) => {
  const parsed = testSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid body" });

  try {
    if (parsed.data.channel === "smtp") {
      await sendEmail("Rack Temp Monitor - Test", "Messaggio di test SMTP riuscito.");
    } else {
      await sendTelegram("Rack Temp Monitor - Messaggio di test Telegram riuscito.");
    }
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "invio fallito" });
  }
});
