import { Router } from "express";
import fs from "fs";
import path from "path";
import { requireAuth } from "../middleware/auth";

export const systemRouter = Router();
systemRouter.use(requireAuth);

// DATABASE_URL is a "file:" path resolved by Prisma relative to
// backend/prisma/ (not the process cwd) — see backend/prisma/schema.prisma.
// Mirror that same resolution here so the backup always points at the real
// database file regardless of how DATABASE_URL is written.
function resolveDbPath(): string | null {
  const url = process.env.DATABASE_URL;
  if (!url || !url.startsWith("file:")) return null;
  const relative = url.slice("file:".length);
  return path.resolve(__dirname, "../../prisma", relative);
}

systemRouter.get("/backup", (_req, res) => {
  const dbPath = resolveDbPath();
  if (!dbPath || !fs.existsSync(dbPath)) {
    return res.status(404).json({ error: "database non trovato" });
  }
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="racktemp-backup-${stamp}.sqlite"`);
  res.sendFile(dbPath);
});
