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

// Set by the Windows installer / Linux install.sh in their generated .env
// (DEPLOY_TARGET=windows / DEPLOY_TARGET=linux). Absent under Docker, where
// there's no single file to hand back — Watchtower/the Portainer webhook
// cover that case instead.
type DeployTarget = "windows" | "linux" | "docker";
function getDeployTarget(): DeployTarget {
  const t = process.env.DEPLOY_TARGET;
  if (t === "windows" || t === "linux") return t;
  return "docker";
}

interface GithubAsset {
  name: string;
  browser_download_url: string;
}
interface ReleaseCache {
  checkedAt: number;
  latestVersion: string;
  releaseUrl: string;
  assets: GithubAsset[];
}
let updateCheckCache: ReleaseCache | null = null;

async function fetchLatestRelease(): Promise<ReleaseCache> {
  if (updateCheckCache && Date.now() - updateCheckCache.checkedAt < UPDATE_CHECK_TTL_MS) {
    return updateCheckCache;
  }
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "rack-temp-monitor" },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const body = (await res.json()) as { tag_name: string; html_url: string; assets: GithubAsset[] };
  const latestVersion = body.tag_name.replace(/^v/, "");
  updateCheckCache = { checkedAt: Date.now(), latestVersion, releaseUrl: body.html_url, assets: body.assets };
  return updateCheckCache;
}

function pickDownloadUrl(assets: GithubAsset[], target: DeployTarget): string | null {
  const matcher = target === "windows" ? /\.exe$/ : target === "linux" ? /\.tar\.gz$/ : null;
  if (!matcher) return null;
  return assets.find((a) => matcher.test(a.name))?.browser_download_url ?? null;
}

systemRouter.get("/update-check", async (_req, res) => {
  try {
    const latest = await fetchLatestRelease();
    const platform = getDeployTarget();
    res.json({
      currentVersion: pkg.version,
      latestVersion: latest.latestVersion,
      updateAvailable: latest.latestVersion !== pkg.version,
      releaseUrl: latest.releaseUrl,
      platform,
      downloadUrl: pickDownloadUrl(latest.assets, platform),
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
