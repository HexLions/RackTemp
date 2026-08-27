import { Router, RequestHandler } from "express";
import { ah } from "../middleware/asyncHandler";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import multer from "multer";
import { z } from "zod";
import { authenticator } from "otplib";
import QRCode from "qrcode";
import { PrismaClient } from "@prisma/client";
import { prisma } from "../db";
import { resolveDbPath, resolveDataDir } from "../services/dbPath";
import { sendEmail } from "../services/notifier";

export const authRouter = Router();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

authRouter.post("/login", ah(async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid body" });

  const { username, password } = parsed.data;
  const user = await prisma.adminUser.findUnique({ where: { username } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: "invalid credentials" });
  }

  if (user.totpEnabled) {
    // Password verified, but the session stays unauthenticated (no userId)
    // until the TOTP code checks out too — requireAuth everywhere else keeps
    // blocking until then. pendingMfaExpires is its own short deadline
    // rather than inheriting the cookie's full 7-day maxAge — a stolen or
    // left-open "enter your TOTP code" state has no business staying valid
    // that long.
    (req.session as any).pendingMfaUserId = user.id;
    (req.session as any).pendingMfaExpires = Date.now() + 5 * 60_000;
    return res.json({ ok: true, mfaRequired: true });
  }

  (req.session as any).userId = user.id;
  (req.session as any).mustChangePassword = user.mustChangePassword;
  (req.session as any).epoch = user.sessionEpoch;
  res.json({ ok: true, username: user.username, mustChangePassword: user.mustChangePassword });
}));

const mfaLoginSchema = z.object({ code: z.string().min(1) });

authRouter.post("/mfa/login", ah(async (req, res) => {
  const session = req.session as any;
  if (!session?.pendingMfaUserId) return res.status(401).json({ error: "not authenticated" });

  if (!session.pendingMfaExpires || Date.now() > session.pendingMfaExpires) {
    session.pendingMfaUserId = undefined;
    session.pendingMfaExpires = undefined;
    return res.status(401).json({ error: "code entry expired, log in again" });
  }

  const parsed = mfaLoginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid body" });

  const user = await prisma.adminUser.findUnique({ where: { id: session.pendingMfaUserId } });
  if (!user?.totpEnabled || !user.totpSecret || !authenticator.check(parsed.data.code, user.totpSecret)) {
    return res.status(401).json({ error: "invalid code" });
  }

  session.pendingMfaUserId = undefined;
  session.pendingMfaExpires = undefined;
  session.userId = user.id;
  session.mustChangePassword = user.mustChangePassword;
  session.epoch = user.sessionEpoch;
  res.json({ ok: true, username: user.username, mustChangePassword: user.mustChangePassword });
}));

authRouter.post("/logout", (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

authRouter.get("/me", ah(async (req, res) => {
  const session = req.session as any;
  if (!session?.userId) return res.status(401).json({ error: "not authenticated" });
  const user = await prisma.adminUser.findUnique({ where: { id: session.userId } });
  if (!user) return res.status(401).json({ error: "not authenticated" });
  res.json({ username: user.username, mustChangePassword: user.mustChangePassword });
}));

// Offline account-recovery code: works without SMTP configured, as an
// alternative to the emailed reset link. 160 bits of entropy, grouped for
// readability. Only the bcrypt hash is ever stored.
function generateRecoveryKey(): string {
  const raw = crypto.randomBytes(20).toString("hex").toUpperCase();
  return raw.match(/.{1,5}/g)!.join("-");
}

// Used only at first login (default admin/admin credentials): the user
// chooses a final username and password before they can use the rest of the app.
const firstLoginSchema = z.object({
  newUsername: z.string().min(3),
  newPassword: z.string().min(8),
  bootstrapToken: z.string().min(1),
});

authRouter.post("/first-login", ah(async (req, res) => {
  const session = req.session as any;
  if (!session?.userId) return res.status(401).json({ error: "not authenticated" });

  const user = await prisma.adminUser.findUnique({ where: { id: session.userId } });
  if (!user) return res.status(401).json({ error: "not authenticated" });
  if (!user.mustChangePassword) return res.status(400).json({ error: "already configured" });

  const parsed = firstLoginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid body" });

  // Requires reading the token off the server's own logs — an authenticated
  // session alone (default admin/admin, reachable to whoever gets there
  // first over the network) is no longer enough to finish setup.
  if (!user.bootstrapTokenHash || !(await bcrypt.compare(parsed.data.bootstrapToken, user.bootstrapTokenHash))) {
    return res.status(401).json({ error: "invalid setup token" });
  }

  const existing = await prisma.adminUser.findUnique({ where: { username: parsed.data.newUsername } });
  if (existing && existing.id !== user.id) {
    return res.status(400).json({ error: "username already in use" });
  }

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
  const recoveryKey = generateRecoveryKey();
  const recoveryKeyHash = await bcrypt.hash(recoveryKey, 10);
  const updated = await prisma.adminUser.update({
    where: { id: user.id },
    data: {
      username: parsed.data.newUsername,
      passwordHash,
      mustChangePassword: false,
      recoveryKeyHash,
      bootstrapTokenHash: null, // one-shot: invalidated as soon as setup succeeds
    },
  });

  session.mustChangePassword = false;
  res.json({ ok: true, username: updated.username, mustChangePassword: false, recoveryKey });
}));

// Only at the very first login (mustChangePassword still true, before the
// user picks real credentials): allows replacing the freshly created database
// with an uploaded .sqlite backup, instead of configuring everything from
// scratch. Double gate — authenticated session + mustChangePassword still
// true — so it can never be invoked on an already-configured instance.
// resolveDataDir(), not a hardcoded "../../data": correct on the native
// Windows/Linux installs too (see services/dbPath.ts).
const RESTORE_TMP_DIR = path.join(resolveDataDir(), "restore-tmp");
fs.mkdirSync(RESTORE_TMP_DIR, { recursive: true });
// An upload interrupted mid-request (client disconnects, process restarts)
// never reaches the handler's own cleanup() below and leaves an orphaned
// file — sweep the directory once at startup instead of letting it grow.
for (const f of fs.readdirSync(RESTORE_TMP_DIR)) {
  fs.unlinkSync(path.join(RESTORE_TMP_DIR, f));
}
const restoreUpload = multer({
  storage: multer.diskStorage({
    destination: RESTORE_TMP_DIR,
    filename: (_req, _file, cb) => cb(null, `upload-${Date.now()}.sqlite`),
  }),
  limits: { fileSize: 200 * 1024 * 1024 },
});

// Multer runs before the route handler, so without this an unauthenticated
// request could still write up to 200MB into RESTORE_TMP_DIR — same volume
// as db.sqlite — before ever being checked. This blocks that at the
// earliest possible point, before multer even starts buffering to disk.
// bootstrapToken can't be checked here: it arrives as a multipart form
// field, which doesn't exist until multer has parsed the body — that check
// stays in the handler below.
const requireFirstLoginSession: RequestHandler = (req, res, next) => {
  const session = req.session as any;
  if (!session?.userId) return res.status(401).json({ error: "not authenticated" });
  next();
};

authRouter.post("/restore-backup", requireFirstLoginSession, restoreUpload.single("backup"), ah(async (req, res) => {
  const cleanup = () => {
    if (req.file) fs.unlink(req.file.path, () => {});
  };

  const session = req.session as any;
  const user = await prisma.adminUser.findUnique({ where: { id: session.userId } });
  if (!user || !user.mustChangePassword) {
    cleanup();
    return res.status(403).json({ error: "restore available only at first login" });
  }

  // Same log-access requirement as /first-login — this replaces the entire
  // database with an uploaded file, an authenticated first-boot session
  // alone shouldn't be enough to trigger it.
  const bootstrapToken = typeof req.body?.bootstrapToken === "string" ? req.body.bootstrapToken : "";
  if (!user.bootstrapTokenHash || !bootstrapToken || !(await bcrypt.compare(bootstrapToken, user.bootstrapTokenHash))) {
    cleanup();
    return res.status(401).json({ error: "invalid setup token" });
  }

  if (!req.file) return res.status(400).json({ error: "missing backup file" });

  // Verify that it's really a RackTemp database before overwriting the
  // current one — opens the uploaded file with a separate client instead
  // of trusting the extension alone.
  const testClient = new PrismaClient({ datasources: { db: { url: `file:${req.file.path}` } } });
  try {
    await testClient.adminUser.findFirst();
  } catch {
    await testClient.$disconnect();
    cleanup();
    return res.status(400).json({ error: "invalid file: not a recognizable RackTemp backup" });
  }
  await testClient.$disconnect();

  const dbPath = resolveDbPath();
  if (!dbPath) {
    cleanup();
    return res.status(500).json({ error: "database path not configured" });
  }

  await prisma.$disconnect();
  fs.copyFileSync(req.file.path, dbPath);
  cleanup();

  res.json({ ok: true, restarting: true });
  // The process needs to restart to reconnect cleanly to the replaced db —
  // Docker/nssm/systemd bring it back up on their own (restart:unless-stopped /
  // default nssm / Restart=on-failure, all of which cover exit code 1).
  setTimeout(() => process.exit(1), 500);
}));

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

authRouter.post("/change-password", ah(async (req, res) => {
  const session = req.session as any;
  if (!session?.userId) return res.status(401).json({ error: "not authenticated" });
  if (session.mustChangePassword) return res.status(403).json({ error: "must_change_password" });

  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid body" });

  const user = await prisma.adminUser.findUnique({ where: { id: session.userId } });
  if (!user || !(await bcrypt.compare(parsed.data.currentPassword, user.passwordHash))) {
    return res.status(401).json({ error: "invalid current password" });
  }

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
  // Bump sessionEpoch: this is the "I think I'm compromised" scenario —
  // every other outstanding session (stolen cookie, unattended device)
  // should stop working. Realign this request's own session.epoch to the
  // updated value from the same query, not epoch+1 computed by hand,
  // otherwise this session logs itself out on its very next request.
  const updated = await prisma.adminUser.update({
    where: { id: user.id },
    data: { passwordHash, sessionEpoch: { increment: 1 } },
  });
  session.epoch = updated.sessionEpoch;
  res.json({ ok: true });
}));

authRouter.get("/mfa/status", ah(async (req, res) => {
  const session = req.session as any;
  if (!session?.userId) return res.status(401).json({ error: "not authenticated" });
  const user = await prisma.adminUser.findUnique({ where: { id: session.userId } });
  res.json({ enabled: user?.totpEnabled ?? false });
}));

// Generates a new secret and returns it as a QR code, but leaves totpEnabled
// false until /mfa/enable confirms the admin actually scanned it correctly —
// otherwise a botched setup could lock them out on next login.
const mfaSetupSchema = z.object({ currentPassword: z.string().min(1).optional() });

authRouter.post("/mfa/setup", ah(async (req, res) => {
  const session = req.session as any;
  if (!session?.userId) return res.status(401).json({ error: "not authenticated" });

  const user = await prisma.adminUser.findUnique({ where: { id: session.userId } });
  if (!user) return res.status(401).json({ error: "not authenticated" });

  // Re-running setup while MFA is already on would silently turn it off
  // (totpEnabled reset to false below) — that's exactly what /mfa/disable
  // guards with a password, so require the same proof here, otherwise
  // anyone riding an already-authenticated session (stolen cookie,
  // unattended device) could strip 2FA without ever knowing the password.
  if (user.totpEnabled) {
    const parsed = mfaSetupSchema.safeParse(req.body);
    if (!parsed.success || !parsed.data.currentPassword) {
      return res.status(400).json({ error: "currentPassword required to reconfigure an already-enabled MFA" });
    }
    if (!(await bcrypt.compare(parsed.data.currentPassword, user.passwordHash))) {
      return res.status(401).json({ error: "invalid current password" });
    }
  }

  const secret = authenticator.generateSecret();
  await prisma.adminUser.update({ where: { id: user.id }, data: { totpSecret: secret, totpEnabled: false } });

  const otpauth = authenticator.keyuri(user.username, "RackTemp", secret);
  const qrDataUrl = await QRCode.toDataURL(otpauth);
  res.json({ ok: true, secret, qrDataUrl });
}));

const mfaEnableSchema = z.object({ code: z.string().min(1) });

authRouter.post("/mfa/enable", ah(async (req, res) => {
  const session = req.session as any;
  if (!session?.userId) return res.status(401).json({ error: "not authenticated" });

  const parsed = mfaEnableSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid body" });

  const user = await prisma.adminUser.findUnique({ where: { id: session.userId } });
  if (!user?.totpSecret) return res.status(400).json({ error: "call /mfa/setup first" });
  if (!authenticator.check(parsed.data.code, user.totpSecret)) {
    return res.status(400).json({ error: "invalid code" });
  }

  // Bump sessionEpoch: a cookie from before MFA was turned on shouldn't
  // keep logging in without a TOTP code. Realign this session's own epoch
  // to the update's return value so this request doesn't self-logout next.
  const updated = await prisma.adminUser.update({
    where: { id: user.id },
    data: { totpEnabled: true, sessionEpoch: { increment: 1 } },
  });
  session.epoch = updated.sessionEpoch;
  res.json({ ok: true });
}));

const mfaDisableSchema = z.object({ currentPassword: z.string().min(1) });

authRouter.post("/mfa/disable", ah(async (req, res) => {
  const session = req.session as any;
  if (!session?.userId) return res.status(401).json({ error: "not authenticated" });

  const parsed = mfaDisableSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid body" });

  const user = await prisma.adminUser.findUnique({ where: { id: session.userId } });
  if (!user || !(await bcrypt.compare(parsed.data.currentPassword, user.passwordHash))) {
    return res.status(401).json({ error: "invalid current password" });
  }

  // Bump sessionEpoch: disabling MFA is a security-posture change, same
  // reasoning as enabling it above. Realign this session's own epoch.
  const updated = await prisma.adminUser.update({
    where: { id: user.id },
    data: { totpEnabled: false, totpSecret: null, sessionEpoch: { increment: 1 } },
  });
  session.epoch = updated.sessionEpoch;
  res.json({ ok: true });
}));

// There is exactly one admin account, so this needs no identifying input.
// The reset link is emailed to the address configured in Settings > Notifications
// (smtpTo) — if that isn't set up, there's no account recovery path other than
// direct database access, same as any single-admin self-hosted app.
const RESET_COOLDOWN_MS = 5 * 60_000;
const RESET_TOKEN_TTL_MS = 30 * 60_000;

authRouter.post("/forgot-password", ah(async (req, res) => {
  const user = await prisma.adminUser.findUnique({ where: { id: 1 } });
  if (!user) return res.status(500).json({ error: "no admin account" });

  if (user.resetRequestedAt && Date.now() - user.resetRequestedAt.getTime() < RESET_COOLDOWN_MS) {
    return res.status(429).json({ error: "reset already requested, check your email or wait a few minutes" });
  }

  const token = crypto.randomBytes(32).toString("hex");
  const resetTokenHash = await bcrypt.hash(token, 10);

  // Never build the link from the request's Host header — it's client-controlled
  // and an attacker could point it at their own domain to steal the token
  // (password-reset poisoning). Only use it if the admin explicitly configured
  // PUBLIC_URL; otherwise send the raw token for manual entry on the reset page.
  const publicUrl = process.env.PUBLIC_URL?.replace(/\/+$/, "");
  const body = publicUrl
    ? `A password reset was requested for your RackTemp admin account.\n\n` +
      `Reset it here (expires in 30 minutes): ${publicUrl}/reset-password?token=${token}\n\n` +
      `If you didn't request this, ignore this email — your password stays unchanged.`
    : `A password reset was requested for your RackTemp admin account.\n\n` +
      `Open your RackTemp instance, go to "Forgot password" and enter this code (expires in 30 minutes):\n\n` +
      `${token}\n\n` +
      `If you didn't request this, ignore this email — your password stays unchanged.`;
  const sent = await sendEmail("RackTemp password reset", body);

  if (!sent) {
    return res.status(400).json({ error: "email notifications are not configured (Settings > Notifications)" });
  }

  await prisma.adminUser.update({
    where: { id: 1 },
    data: {
      resetTokenHash,
      resetTokenExpiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      resetRequestedAt: new Date(),
    },
  });

  res.json({ ok: true });
}));

// Logged-in admin can roll a fresh recovery key any time (e.g. the old one
// was lost, or they suspect it leaked). Shown once in the response, same as
// at first login. Requires the current password, same as /mfa/disable —
// otherwise anyone riding an already-authenticated session (stolen cookie,
// unattended device) could mint themselves a working recovery key and keep
// access even after the admin changes the password.
const regenerateRecoveryKeySchema = z.object({ currentPassword: z.string().min(1) });

authRouter.post("/regenerate-recovery-key", ah(async (req, res) => {
  const session = req.session as any;
  if (!session?.userId) return res.status(401).json({ error: "not authenticated" });

  const parsed = regenerateRecoveryKeySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid body" });

  const user = await prisma.adminUser.findUnique({ where: { id: session.userId } });
  if (!user || !(await bcrypt.compare(parsed.data.currentPassword, user.passwordHash))) {
    return res.status(401).json({ error: "invalid current password" });
  }

  const recoveryKey = generateRecoveryKey();
  const recoveryKeyHash = await bcrypt.hash(recoveryKey, 10);
  await prisma.adminUser.update({ where: { id: session.userId }, data: { recoveryKeyHash } });

  res.json({ ok: true, recoveryKey });
}));

// Offline password reset: no session, no SMTP required — just the recovery
// key printed at first login (or the Account settings page). The key is
// rotated on every successful use so a saved copy stays usable going forward.
const resetWithKeySchema = z.object({
  recoveryKey: z.string().min(1),
  newPassword: z.string().min(8),
});

authRouter.post("/reset-password-with-key", ah(async (req, res) => {
  const parsed = resetWithKeySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid body" });

  const user = await prisma.adminUser.findUnique({ where: { id: 1 } });
  if (!user?.recoveryKeyHash) return res.status(400).json({ error: "no recovery key set for this account" });
  if (!(await bcrypt.compare(parsed.data.recoveryKey, user.recoveryKeyHash))) {
    return res.status(400).json({ error: "invalid recovery key" });
  }

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
  const newRecoveryKey = generateRecoveryKey();
  const recoveryKeyHash = await bcrypt.hash(newRecoveryKey, 10);
  await prisma.adminUser.update({
    where: { id: 1 },
    data: {
      passwordHash,
      recoveryKeyHash,
      resetTokenHash: null,
      resetTokenExpiresAt: null,
      resetRequestedAt: null,
      // Also drop MFA — if they needed the recovery key, they may have lost
      // their authenticator device too, and it's better to let them back in
      // than have password + MFA both need separate recovery.
      totpEnabled: false,
      totpSecret: null,
      // No session to realign here (this whole flow is sessionless) — any
      // outstanding cookie from before the reset needs a fresh login either
      // way, which is exactly what bumping the epoch forces.
      sessionEpoch: { increment: 1 },
    },
  });

  res.json({ ok: true, newRecoveryKey });
}));

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8),
});

authRouter.post("/reset-password", ah(async (req, res) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid body" });

  const user = await prisma.adminUser.findUnique({ where: { id: 1 } });
  if (!user?.resetTokenHash || !user.resetTokenExpiresAt) {
    return res.status(400).json({ error: "no reset requested" });
  }
  if (user.resetTokenExpiresAt.getTime() < Date.now()) {
    return res.status(400).json({ error: "reset link expired, request a new one" });
  }
  if (!(await bcrypt.compare(parsed.data.token, user.resetTokenHash))) {
    return res.status(400).json({ error: "invalid reset link" });
  }

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
  await prisma.adminUser.update({
    where: { id: 1 },
    data: {
      passwordHash,
      resetTokenHash: null,
      resetTokenExpiresAt: null,
      resetRequestedAt: null,
      totpEnabled: false,
      totpSecret: null,
      // No session to realign (sessionless flow) — forces any outstanding
      // cookie from before the reset to log in again.
      sessionEpoch: { increment: 1 },
    },
  });

  res.json({ ok: true });
}));
