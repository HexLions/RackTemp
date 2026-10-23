import express from "express";
import cookieSession from "cookie-session";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/db";
import { authRouter } from "../src/routes/auth";
import { firmwareRouter } from "../src/routes/firmware";
import { sensorsRouter } from "../src/routes/sensors";
import { systemRouter } from "../src/routes/system";

// Mirrors the middleware/router wiring in src/index.ts, which builds the
// app inside main() and doesn't export it. Differences on purpose: no rate
// limiters (tests log in many times) and a non-secure cookie, because
// supertest talks plain HTTP and cookie-session refuses to set a secure
// cookie there.
export function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(
    cookieSession({
      name: "session",
      keys: ["test-session-secret"],
      maxAge: 3600_000,
      sameSite: "strict",
      secure: false,
      httpOnly: true,
    }),
  );
  app.use("/api/auth", authRouter);
  app.use("/api/sensors", sensorsRouter);
  app.use("/api/system", systemRouter);
  app.use("/api/firmware", firmwareRouter);
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return res.status(404).json({ error: "not found" });
    }
    console.error(err);
    res.status(500).json({ error: "internal server error" });
  });
  return app;
}

export async function resetDb() {
  await prisma.auditLog.deleteMany();
  await prisma.notificationLog.deleteMany();
  await prisma.threshold.deleteMany();
  await prisma.reading.deleteMany();
  await prisma.sensor.deleteMany();
  await prisma.viewerUser.deleteMany();
  await prisma.adminUser.deleteMany();
}

export const ADMIN_USERNAME = "admin1";
export const ADMIN_PASSWORD = "correct-horse-battery";

// bcrypt cost 4 instead of the app's 12 keeps the suite fast; bcrypt.compare
// reads the cost from the hash, so the app's own checks are unaffected.
export async function createAdmin(overrides: Partial<Prisma.AdminUserCreateInput> = {}) {
  return prisma.adminUser.create({
    data: {
      id: 1,
      username: ADMIN_USERNAME,
      passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 4),
      mustChangePassword: false,
      ...overrides,
    },
  });
}

export async function createViewer(username: string, password: string) {
  return prisma.viewerUser.create({
    data: { username, passwordHash: await bcrypt.hash(password, 4) },
  });
}
