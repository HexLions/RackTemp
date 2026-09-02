import "dotenv/config";
import express from "express";
import cookieSession from "cookie-session";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import path from "path";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { createServer as createHttpsServer } from "https";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { authRouter } from "./routes/auth";
import { sensorsRouter } from "./routes/sensors";
import { ingestRouter } from "./routes/ingest";
import { notificationsRouter } from "./routes/notifications";
import { prtgRouter } from "./routes/prtg";
import { statusRouter } from "./routes/status";
import { discoveryRouter } from "./routes/discovery";
import { metricsRouter } from "./routes/metrics";
import { integrationsRouter } from "./routes/integrations";
import { versionRouter } from "./routes/version";
import { firmwareRouter } from "./routes/firmware";
import { systemRouter } from "./routes/system";
import { startOfflineWatcher } from "./services/thresholdEngine";
import { startRetentionWatcher } from "./services/retention";
import { startBackupScheduler } from "./services/backupScheduler";
import { resolveSessionSecret } from "./services/sessionSecret";
import { resolveTlsCert } from "./services/tls";
import { writeSetupTokenFile, clearSetupTokenFile } from "./services/setupTokenFile";
import { initWs } from "./ws";

const PORT = Number(process.env.PORT) || 7431;
const SESSION_SECRET = resolveSessionSecret();

// 8 hex chars — same "not a strong secret, but requires access to something
// only the operator has" bar as the setup portal's AP password (see the
// firmware). Whoever completes /first-login or /restore-backup needs to
// have read this from the server's own logs (docker compose logs /
// journalctl -u racktemp / service.log on Windows) or the SETUP-TOKEN.txt
// file next to the database (services/setupTokenFile.ts — also what the
// Windows tray app watches for a balloon notification), not just be first
// to hit the endpoint over the network — the default admin/admin
// credentials alone used to be enough.
function generateBootstrapToken(): string {
  return randomBytes(4).toString("hex");
}

async function bootstrapAdmin() {
  const existing = await prisma.adminUser.findFirst();

  if (!existing) {
    const passwordHash = await bcrypt.hash("admin", 12);
    const bootstrapToken = generateBootstrapToken();
    const bootstrapTokenHash = await bcrypt.hash(bootstrapToken, 12);
    await prisma.adminUser.create({
      data: { username: "admin", passwordHash, mustChangePassword: true, bootstrapTokenHash },
    });
    console.log('[bootstrap] created default admin user "admin" / "admin" — you will be asked to set a real username and password on first login');
    console.log(`[bootstrap] setup token (needed for first-login / restore-backup): ${bootstrapToken}`);
    writeSetupTokenFile(bootstrapToken);
    return;
  }

  if (!existing.mustChangePassword) {
    // Already configured — e.g. this boot is right after /restore-backup
    // replaced the database with one belonging to a fully set-up admin.
    // Any leftover SETUP-TOKEN.txt from before the restore is now for a
    // token that no longer matches anything; clear it rather than leave a
    // stale file around.
    clearSetupTokenFile();
    return;
  }

  // Setup was never finished (process restarted before /first-login
  // succeeded) — the previous token is only known from a now-scrolled-away
  // log, so hand out a fresh one every time this happens rather than
  // leaving the instance impossible to finish setting up without wiping
  // the database.
  const bootstrapToken = generateBootstrapToken();
  const bootstrapTokenHash = await bcrypt.hash(bootstrapToken, 12);
  await prisma.adminUser.update({ where: { id: existing.id }, data: { bootstrapTokenHash } });
  console.log(`[bootstrap] setup not finished yet — setup token (needed for first-login / restore-backup): ${bootstrapToken}`);
  writeSetupTokenFile(bootstrapToken);
}

async function main() {
  await bootstrapAdmin();

  const app = express();

  // Only needed behind a reverse proxy: without this, req.ip is the proxy's
  // own address and every client shares one rate-limit bucket. Set too high
  // (or without a proxy actually stripping/setting X-Forwarded-For) and the
  // client IP becomes spoofable via that header instead.
  if (process.env.TRUST_PROXY_HOPS) {
    app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS));
  }

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", "data:"], // MFA QR code is a data: URL
          styleSrc: ["'self'", "'unsafe-inline'"],
          connectSrc: ["'self'", "ws:", "wss:"],
          frameAncestors: ["'none'"],
          // No override needed here any more: the app is HTTPS-only now
          // (self-signed cert, generated on first boot — see tls.ts), so
          // helmet's default upgradeInsecureRequests directive (rewriting
          // any stray http: sub-resource reference to https:) is correct
          // instead of actively harmful, unlike when this could still be
          // plain HTTP.
        },
      },
      // Deliberately still off, even though the app is HTTPS-only now:
      // this is a LAN appliance typically accessed by IP address, not a
      // stable domain. HSTS is a browser-side, per-host cache with no
      // expiry the app controls - if this IP is ever reassigned by DHCP to
      // a different device after RackTemp is decommissioned, any browser
      // that still remembers "always HTTPS for this IP" would force HTTPS
      // onto that unrelated future device too. Not worth that pitfall for
      // the marginal benefit here (a first-visit self-signed-cert warning
      // already flags anything suspicious about the connection).
      hsts: false,
    })
  );

  // No CORS middleware: the frontend is always same-origin. In production
  // it's served by this same Express instance (static + SPA fallback below);
  // in dev, Vite's own proxy (vite.config.ts) forwards /api and /ws
  // server-to-server, so the browser never makes a cross-origin request
  // either way. The previous `origin: true` reflected any Origin header
  // with credentials allowed — permissive for no actual benefit.
  app.use(express.json());
  // Default lowered from the old 7 days to 24h: a week-long cookie is a lot
  // of standing exposure for a stolen/left-open session, and 24h already
  // covers a full workday without re-login. Configurable for setups that
  // want it shorter (or, if you really want the old behavior back, longer).
  const sessionMaxAgeMs = (Number(process.env.SESSION_MAX_AGE_HOURS) || 24) * 3600_000;
  app.use(
    cookieSession({
      name: "session",
      keys: [SESSION_SECRET],
      maxAge: sessionMaxAgeMs,
      // "strict" over "lax": nothing in this app links in from another site,
      // so there's no legitimate cross-site GET that needs the cookie —
      // strict closes that off too. secure is unconditional now: the app
      // is HTTPS-only (see below), there's no plain-HTTP mode left where
      // marking the cookie Secure would break sending it.
      sameSite: "strict",
      secure: true,
      httpOnly: true,
    })
  );

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

  app.use("/api/auth/login", authLimiter);
  app.use("/api/auth/viewer-login", authLimiter);
  app.use("/api/auth/mfa/login", authLimiter);
  app.use("/api/auth/reset-password", authLimiter);
  app.use("/api/auth/reset-password-with-key", authLimiter);
  // Both guard the bootstrap token (32 bits of entropy) — the only other
  // endpoints in this group without a limiter.
  app.use("/api/auth/first-login", authLimiter);
  app.use("/api/auth/restore-backup", authLimiter);
  app.use("/api/discovery/announce", announceLimiter);
  app.use("/api/firmware/latest", firmwarePublicLimiter);
  app.use("/api/firmware/latest.bin", firmwarePublicLimiter);

  app.use("/api/auth", authRouter);
  app.use("/api/sensors", sensorsRouter);
  app.use("/api/ingest", ingestRouter);
  app.use("/api/notifications", notificationsRouter);
  app.use("/api/prtg", prtgRouter);
  app.use("/api/status", statusRouter);
  app.use("/api/discovery", discoveryRouter);
  app.use("/api/integrations", integrationsRouter);
  app.use("/api/version", versionRouter);
  app.use("/api/firmware", firmwareRouter);
  app.use("/api/system", systemRouter);
  app.use("/metrics", metricsRouter);

  const frontendDist = path.join(__dirname, "../public");
  app.use(express.static(frontendDist));
  // Express 5 / path-to-regexp 8: bare "*" is gone, a wildcard now needs a
  // name. "/*splat" alone isn't the full equivalent though — it matches one
  // or more segments, so "/" itself falls through (express.static already
  // serves index.html for "/" today, so this was silently not a complete
  // safety net). Listing "/" explicitly alongside it closes that gap.
  app.get(["/", "/*splat"], (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(frontendDist, "index.html"));
  });

  // Catches every rejection the ah() wrapper forwards via next(err) — without
  // this Express 4's own default error handler would still respond, but by
  // dumping the stack trace straight into the response body. Registered
  // last, per Express convention for error-handling middleware.
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return res.status(404).json({ error: "not found" });
    }
    console.error(err);
    res.status(500).json({ error: "internal server error" });
  });

  // Always HTTPS - no plain-HTTP mode any more. The cert is self-signed,
  // generated on first boot and reused after that (services/tls.ts); a
  // fresh install's very first request already gets served over TLS, no
  // separate opt-in step. Regenerating the cert (Settings > Network) still
  // needs a restart to actually be served - no live-reload of an active
  // https.Server's certificate, and doing that mid-request (including any
  // open WebSocket upgrade) isn't worth the complexity for something
  // that's rarely needed (e.g. the LAN IP changed).
  const server = createHttpsServer(await resolveTlsCert(), app);
  initWs(server, SESSION_SECRET);
  startOfflineWatcher();
  startRetentionWatcher();
  startBackupScheduler();

  server.listen(PORT, () => console.log(`rack-temp-monitor listening on https://0.0.0.0:${PORT}`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
