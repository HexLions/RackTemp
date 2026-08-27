import { Router } from "express";
import { ah } from "../middleware/asyncHandler";
import fs from "fs";
import path from "path";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { prisma } from "../db";
import { resolveDbPath } from "../services/dbPath";
import { BACKUPS_DIR, getBackupSettings, listBackups, performBackup } from "../services/backupScheduler";
import { getServerSettings, setHttpsEnabled } from "../services/serverSettings";
import { tlsCertInfo, regenerateTlsCert } from "../services/tls";
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

systemRouter.get("/update-check", ah(async (_req, res) => {
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
    res.status(502).json({ error: "unable to check releases on GitHub" });
  }
}));

systemRouter.post("/trigger-update", ah(async (_req, res) => {
  const settings = await prisma.integrationSettings.findUnique({ where: { id: 1 } });
  if (!settings?.portainerWebhookUrl) {
    return res.status(400).json({ error: "no Portainer webhook configured in Integrations" });
  }
  try {
    const hookRes = await fetch(settings.portainerWebhookUrl, { method: "POST" });
    if (!hookRes.ok) throw new Error(`webhook responded ${hookRes.status}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "webhook failed" });
  }
}));

// POST, not GET: this downloads the entire database (admin password hash,
// sensor API keys, notification credentials) — a GET could be triggered by
// mere navigation or an embedded resource, not just a deliberate click.
systemRouter.post("/backup", (_req, res) => {
  const dbPath = resolveDbPath();
  if (!dbPath || !fs.existsSync(dbPath)) {
    return res.status(404).json({ error: "database not found" });
  }
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="racktemp-backup-${stamp}.sqlite"`);
  res.sendFile(dbPath);
});

const backupSettingsSchema = z.object({
  enabled: z.boolean(),
  intervalHours: z.number().int().min(1).max(24 * 30),
  retentionCount: z.number().int().min(1).max(365),
  emailOnBackup: z.boolean(),
});

systemRouter.get("/backup-settings", ah(async (_req, res) => {
  res.json(await getBackupSettings());
}));

systemRouter.put("/backup-settings", ah(async (req, res) => {
  const parsed = backupSettingsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  await getBackupSettings();
  const updated = await prisma.backupSettings.update({ where: { id: 1 }, data: parsed.data });
  res.json(updated);
}));

systemRouter.get("/backups", (_req, res) => {
  res.json(listBackups());
});

systemRouter.post("/backups/run", ah(async (req, res) => {
  const emailIt = req.body?.email === true;
  try {
    const result = await performBackup(emailIt);
    if (!result) return res.status(404).json({ error: "database not found" });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "backup failed" });
  }
}));

systemRouter.get("/backups/:name/download", (req, res) => {
  const name = req.params.name;
  if (!/^racktemp-backup-[\w-]+\.sqlite$/.test(name)) return res.status(400).end();
  const filePath = path.join(BACKUPS_DIR, name);
  if (!fs.existsSync(filePath)) return res.status(404).end();
  res.download(filePath, name);
});

// Toggle only — the actual protocol switch happens once at boot (index.ts
// reads ServerSettings before creating the server), so flipping this here
// doesn't affect the currently running process. The frontend tells the
// admin a restart is needed.
systemRouter.get("/https-settings", ah(async (_req, res) => {
  const settings = await getServerSettings();
  res.json({ httpsEnabled: settings.httpsEnabled, cert: tlsCertInfo() });
}));

const httpsSettingsSchema = z.object({ httpsEnabled: z.boolean() });

systemRouter.put("/https-settings", ah(async (req, res) => {
  const parsed = httpsSettingsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const settings = await setHttpsEnabled(parsed.data.httpsEnabled);
  res.json({ httpsEnabled: settings.httpsEnabled, cert: tlsCertInfo() });
}));

// Forces a fresh self-signed cert — e.g. the machine's LAN IP changed since
// the current one was generated (its Subject Alternative Names no longer
// match, so browsers reject it as invalid for this address on top of the
// usual self-signed warning).
systemRouter.post("/https-settings/regenerate-cert", ah(async (_req, res) => {
  await regenerateTlsCert();
  // tlsCertInfo() re-reads the file we just wrote rather than trusting
  // regenerateTlsCert()'s own return value, so the fingerprint here is
  // computed the same way (Node's X509Certificate) as the GET endpoint's —
  // selfsigned's own .fingerprint field uses a different format.
  res.json(tlsCertInfo());
}));
