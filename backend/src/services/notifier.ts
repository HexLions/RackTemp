import nodemailer from "nodemailer";
import { Api as TelegramApi } from "node-telegram-bot-api";
import { prisma } from "../db";
import { sendGraphMail } from "./graphMailer";
import { decryptField } from "./fieldEncryption";

// Single choke point every consumer below (and sendGraphMail, which
// receives this same object) goes through — decrypting here once means
// smtpPass/telegramToken/graphClientSecret arrive already in plaintext
// everywhere else in this file.
async function getConfig() {
  const cfg = await prisma.notificationConfig.findUnique({ where: { id: 1 } });
  if (!cfg) return cfg;
  return {
    ...cfg,
    smtpPass: decryptField(cfg.smtpPass),
    telegramToken: decryptField(cfg.telegramToken),
    graphClientSecret: decryptField(cfg.graphClientSecret),
  };
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

// Used only by the Settings > Notifications "Send test" button - unlike
// sendEmail() below (also used for real alerts, where silently doing
// nothing because the channel is disabled/unconfigured is correct,
// everyday behavior), a deliberate test click should say exactly what
// happened. nodemailer's sendMail() does throw if the SMTP server rejects
// every recipient ("Can't send mail - all recipients were rejected" -
// confirmed by reading the actual installed nodemailer source, not
// assumed), so a successful resolve here does mean the destination mail
// server genuinely accepted the message for delivery - if it still never
// shows up, that's happening after acceptance, outside anything this app
// can see or control (spam filtering, greylisting, the "From" address not
// being one this SMTP account/relay is allowed to send as, missing
// SPF/DKIM on a self-hosted relay, ...). Returning the server's own raw
// response line is the most concrete lead for tracking that down - it's
// what the receiving/relaying server itself said, worth comparing against
// its own logs or a mail-provider's postmaster tools.
export async function sendTestEmail(): Promise<string> {
  const cfg = await getConfig();
  if (!cfg?.smtpEnabled) {
    throw new Error('Email notifications are disabled - check "Enable email notifications" above and Save first.');
  }
  if (!cfg.smtpTo) {
    throw new Error('No "To" address configured - fill it in and Save first.');
  }

  if (cfg.emailProvider === "graph") {
    const sent = await sendGraphMail(cfg, cfg.smtpTo, "Rack Temp Monitor - Test", "SMTP test message succeeded.");
    if (!sent) {
      throw new Error("Tenant ID, Client ID, Client secret, or Sender mailbox is missing - fill them in and Save first.");
    }
    // Graph's sendMail call is fire-and-forget from the caller's point of
    // view - a 202 response is genuinely the most detail Microsoft's API
    // gives back at send time, no per-recipient accept/reject like SMTP.
    return "Accepted by Microsoft Graph (202). Graph doesn't report per-recipient delivery status at send time - this only confirms the API call itself succeeded, not that the message reached the inbox.";
  }

  if (!cfg.smtpHost) {
    throw new Error("No SMTP host configured - fill it in and Save first.");
  }

  const transport = nodemailer.createTransport({
    host: cfg.smtpHost,
    port: cfg.smtpPort ?? 587,
    secure: cfg.smtpSecure,
    auth: cfg.smtpUser ? { user: cfg.smtpUser, pass: cfg.smtpPass ?? undefined } : undefined,
  });

  const info = await transport.sendMail({
    from: cfg.smtpFrom ?? cfg.smtpUser ?? "rack-temp-monitor@localhost",
    to: cfg.smtpTo,
    subject: "Rack Temp Monitor - Test",
    text: "SMTP test message succeeded.",
  });

  return `Accepted by ${cfg.smtpHost}: ${info.response}`;
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
