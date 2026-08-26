import nodemailer from "nodemailer";
import { Api as TelegramApi } from "node-telegram-bot-api";
import { prisma } from "../db";
import { sendGraphMail } from "./graphMailer";

async function getConfig() {
  return prisma.notificationConfig.findUnique({ where: { id: 1 } });
}

export async function sendEmail(
  subject: string,
  text: string,
  attachments?: { filename: string; path: string }[]
) {
  const cfg = await getConfig();
  if (!cfg?.smtpEnabled || !cfg.smtpTo) return false;

  if (cfg.emailProvider === "graph") {
    return sendGraphMail(cfg, cfg.smtpTo, subject, text, attachments);
  }

  if (!cfg.smtpHost) return false;

  const transport = nodemailer.createTransport({
    host: cfg.smtpHost,
    port: cfg.smtpPort ?? 587,
    secure: cfg.smtpSecure,
    auth: cfg.smtpUser ? { user: cfg.smtpUser, pass: cfg.smtpPass ?? undefined } : undefined,
  });

  await transport.sendMail({
    from: cfg.smtpFrom ?? cfg.smtpUser ?? "rack-temp-monitor@localhost",
    to: cfg.smtpTo,
    subject,
    text,
    attachments,
  });
  return true;
}

export async function sendTelegram(text: string) {
  const cfg = await getConfig();
  if (!cfg?.telegramEnabled || !cfg.telegramToken || !cfg.telegramChatId) return;

  // node-telegram-bot-api v2 is a from-scratch rewrite (no v1 compat) — the
  // old TelegramBot(token, {polling:false}) constructor no longer exists.
  // Api is v2's direct REST client with no polling loop, the right
  // replacement for a fire-and-forget outbound message.
  const api = new TelegramApi(cfg.telegramToken);
  await api.sendMessage({ chat_id: cfg.telegramChatId, text });
}

export async function notifyAll(subject: string, text: string) {
  await Promise.allSettled([sendEmail(subject, text), sendTelegram(text)]);
}
