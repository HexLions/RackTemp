import type { Express } from "express";
import rateLimit from "express-rate-limit";

// Mounted before the routers. A function rather than module-level limiters so
// every app instance (the server, each test app) gets its own in-memory store.
export function applyRateLimits(app: Express) {
  const authLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 10,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "too many attempts, retry later" },
  });
  const announceLimiter = rateLimit({ windowMs: 60_000, limit: 30, legacyHeaders: false });
  // CodeQL (js/missing-rate-limiting) flagged these two: public, no auth,
  // sensors poll /latest every boot + daily, so a generous limit — this
  // exists for anonymous-hammering protection, not to constrain normal use.
  const firmwarePublicLimiter = rateLimit({ windowMs: 60_000, limit: 60, legacyHeaders: false });
  // Routes behind an admin session that check the current password (or, for
  // mfa/enable, a TOTP code). Without a limit, a stolen session cookie is an
  // unlimited password-guessing oracle. Only failed requests (status >= 400)
  // count, so normal use never gets near the limit.
  const reauthLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 10,
    skipSuccessfulRequests: true,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "too many attempts, retry later" },
  });

  app.use("/api/auth/login", authLimiter);
  app.use("/api/auth/viewer-login", authLimiter);
  app.use("/api/auth/mfa/login", authLimiter);
  app.use("/api/auth/reset-password", authLimiter);
  app.use("/api/auth/reset-password-with-key", authLimiter);
  // Both guard the bootstrap token (32 bits of entropy) — the only other
  // endpoints in this group without a limiter.
  app.use("/api/auth/first-login", authLimiter);
  app.use("/api/auth/restore-backup", authLimiter);
  app.use("/api/auth/change-password", reauthLimiter);
  app.use("/api/auth/mfa/setup", reauthLimiter);
  app.use("/api/auth/mfa/enable", reauthLimiter);
  app.use("/api/auth/mfa/disable", reauthLimiter);
  app.use("/api/auth/regenerate-recovery-key", reauthLimiter);
  app.use("/api/discovery/announce", announceLimiter);
  app.use("/api/firmware/latest", firmwarePublicLimiter);
  app.use("/api/firmware/latest.bin", firmwarePublicLimiter);
}
