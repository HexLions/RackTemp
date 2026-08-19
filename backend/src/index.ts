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
import { startOfflineWatcher } from "./services/thresholdEngine";
import { initWs } from "./ws";

const PORT = Number(process.env.PORT) || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || "change-me-in-production";

async function bootstrapAdmin() {
  const existing = await prisma.adminUser.findFirst();
  if (existing) return;

  const username = process.env.ADMIN_USERNAME || "admin";
  const password = process.env.ADMIN_PASSWORD || "changeme";
  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.adminUser.create({ data: { username, passwordHash } });
  console.log(`[bootstrap] created admin user "${username}" — change the password after first login`);
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
