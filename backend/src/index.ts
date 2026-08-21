import "dotenv/config";
import express from "express";
import cookieSession from "cookie-session";
import cors from "cors";
import path from "path";
import bcrypt from "bcryptjs";
import { createServer } from "http";
import { prisma } from "./db";
import { authRouter } from "./routes/auth";
import { sensorsRouter } from "./routes/sensors";
import { ingestRouter } from "./routes/ingest";
import { notificationsRouter } from "./routes/notifications";
import { prtgRouter } from "./routes/prtg";
import { discoveryRouter } from "./routes/discovery";
import { metricsRouter } from "./routes/metrics";
import { integrationsRouter } from "./routes/integrations";
import { versionRouter } from "./routes/version";
import { startOfflineWatcher } from "./services/thresholdEngine";
import { initWs } from "./ws";

const PORT = Number(process.env.PORT) || 7431;
const SESSION_SECRET = process.env.SESSION_SECRET || "change-me-in-production";

async function bootstrapAdmin() {
  const existing = await prisma.adminUser.findFirst();
  if (existing) return;

  const passwordHash = await bcrypt.hash("admin", 10);
  await prisma.adminUser.create({
    data: { username: "admin", passwordHash, mustChangePassword: true },
  });
  console.log('[bootstrap] created default admin user "admin" / "admin" — you will be asked to set a real username and password on first login');
}

async function main() {
  await bootstrapAdmin();

  const app = express();
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json());
  app.use(
    cookieSession({
      name: "session",
      keys: [SESSION_SECRET],
      maxAge: 7 * 24 * 3600_000,
      sameSite: "lax",
    })
  );

  app.use("/api/auth", authRouter);
  app.use("/api/sensors", sensorsRouter);
  app.use("/api/ingest", ingestRouter);
  app.use("/api/notifications", notificationsRouter);
  app.use("/api/prtg", prtgRouter);
  app.use("/api/discovery", discoveryRouter);
  app.use("/api/integrations", integrationsRouter);
  app.use("/api/version", versionRouter);
  app.use("/metrics", metricsRouter);

  const frontendDist = path.join(__dirname, "../public");
  app.use(express.static(frontendDist));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(frontendDist, "index.html"));
  });

  const server = createServer(app);
  initWs(server);
  startOfflineWatcher();

  server.listen(PORT, () => console.log(`rack-temp-monitor listening on :${PORT}`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
