import "dotenv/config";
import express from "express";
import cookieSession from "cookie-session";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import path from "path";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { createServer } from "http";
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
import { initWs } from "./ws";

const PORT = Number(process.env.PORT) || 7431;
const SESSION_SECRET = resolveSessionSecret();

// 8 hex chars — same "not a strong secret, but requires access to something
// only the operator has" bar as the setup portal's AP password (see the
// firmware). Whoever completes /first-login or /restore-backup needs to
// have read this from the server's own logs (docker compose logs /
// journalctl -u racktemp), not just be first to hit the endpoint over the
// network — the default admin/admin credentials alone used to be enough.
function generateBootstrapToken(): string {
  return randomBytes(4).toString("hex");
}

async function bootstrapAdmin() {
  const existing = await prisma.adminUser.findFirst();

  if (!existing) {
    const passwordHash = await bcrypt.hash("admin", 10);
    const bootstrapToken = generateBootstrapToken();
    const bootstrapTokenHash = await bcrypt.hash(bootstrapToken, 10);
    await prisma.adminUser.create({
      data: { username: "admin", passwordHash, mustChangePassword: true, bootstrapTokenHash },
    });
    console.log('[bootstrap] created default admin user "admin" / "admin" — you will be asked to set a real username and password on first login');
    console.log(`[bootstrap] setup token (needed for first-login / restore-backup): ${bootstrapToken}`);
    return;
  }

  // Setup was never finished (process restarted before /first-login
  // succeeded) — the previous token is only known from a now-scrolled-away
  // log, so hand out a fresh one every time this happens rather than
  // leaving the instance impossible to finish setting up without wiping
  // the database.
  if (existing.mustChangePassword) {
    const bootstrapToken = generateBootstrapToken();
    const bootstrapTokenHash = await bcrypt.hash(bootstrapToken, 10);
    await prisma.adminUser.update({ where: { id: existing.id }, data: { bootstrapTokenHash } });
    console.log(`[bootstrap] setup not finished yet — setup token (needed for first-login / restore-backup): ${bootstrapToken}`);
  }
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
          // Helmet's default directive set includes this even though we only
          // pass our own `directives` (useDefaults defaults to true, and the
          // two are merged) — it tells the browser to silently rewrite every
          // http: sub-resource request on the page to https:. Fine behind a
          // TLS-terminating reverse proxy, but this app is plain HTTP by
          // default (typical LAN deploy, see hsts below): with it on, every
          // asset request gets upgraded to an https: URL nothing is listening
          // on and fails with ERR_SSL_PROTOCOL_ERROR — blank, unstyled page,
          // no JS. `null` here removes the inherited directive instead of
          // setting it, per helmet's own merge behavior (node_modules/helmet/index.cjs).
          upgradeInsecureRequests: null,
        },
      },
      hsts: false, // no-op on plain HTTP; a reverse proxy in front would set it
    })
  );

  // No CORS middleware: the frontend is always same-origin. In production
  // it's served by this same Express instance (static + SPA fallback below);
  // in dev, Vite's own proxy (vite.config.ts) forwards /api and /ws
  // server-to-server, so the browser never makes a cross-origin request
  // either way. The previous `origin: true` reflected any Origin header
  // with credentials allowed — permissive for no actual benefit.
  app.use(express.json());
  app.use(
    cookieSession({
      name: "session",
      keys: [SESSION_SECRET],
      maxAge: 7 * 24 * 3600_000,
      // "strict" over "lax": nothing in this app links in from another site,
      // so there's no legitimate cross-site GET that needs the cookie —
      // strict closes that off too. Set COOKIE_SECURE=1 once there's an
      // HTTPS reverse proxy in front (can't default it on, would break
      // plain-HTTP LAN deploys, which is the common case here).
      sameSite: "strict",
      secure: process.env.COOKIE_SECURE === "1",
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

  app.use("/api/auth/login", authLimiter);
  app.use("/api/auth/mfa/login", authLimiter);
  app.use("/api/auth/reset-password", authLimiter);
  app.use("/api/auth/reset-password-with-key", authLimiter);
  app.use("/api/discovery/announce", announceLimiter);

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
  app.get("*", (req, res, next) => {
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

  const server = createServer(app);
  initWs(server, SESSION_SECRET);
  startOfflineWatcher();
  startRetentionWatcher();
  startBackupScheduler();

  server.listen(PORT, () => console.log(`rack-temp-monitor listening on :${PORT}`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
