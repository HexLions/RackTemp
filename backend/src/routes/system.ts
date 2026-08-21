import { Router } from "express";
import fs from "fs";
import path from "path";
import { requireAuth } from "../middleware/auth";
import { prisma } from "../db";
import pkg from "../../package.json";

export const systemRouter = Router();
systemRouter.use(requireAuth);

const GITHUB_REPO = "HexLions/RackTemp";
const UPDATE_CHECK_TTL_MS = 6 * 60 * 60 * 1000;
let updateCheckCache: { checkedAt: number; latestVersion: string; releaseUrl: string } | null = null;

async function fetchLatestRelease() {
  if (updateCheckCache && Date.now() - updateCheckCache.checkedAt < UPDATE_CHECK_TTL_MS) {
    return updateCheckCache;
  }
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "rack-temp-monitor" },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const body = (await res.json()) as { tag_name: string; html_url: string };
  const latestVersion = body.tag_name.replace(/^v/, "");
  updateCheckCache = { checkedAt: Date.now(), latestVersion, releaseUrl: body.html_url };
  return updateCheckCache;
}

systemRouter.get("/update-check", async (_req, res) => {
  try {
    const latest = await fetchLatestRelease();
    res.json({
      currentVersion: pkg.version,
      latestVersion: latest.latestVersion,
      updateAvailable: latest.latestVersion !== pkg.version,
      releaseUrl: latest.releaseUrl,
    });
  } catch {
    res.status(502).json({ error: "impossibile controllare le release su GitHub" });
  }
});

systemRouter.post("/trigger-update", async (_req, res) => {
  const settings = await prisma.integrationSettings.findUnique({ where: { id: 1 } });
  if (!settings?.portainerWebhookUrl) {
    return res.status(400).json({ error: "nessun webhook Portainer configurato in Integrazioni" });
  }
  try {
    const hookRes = await fetch(settings.portainerWebhookUrl, { method: "POST" });
    if (!hookRes.ok) throw new Error(`webhook risposto ${hookRes.status}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "webhook fallito" });
  }
});

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
