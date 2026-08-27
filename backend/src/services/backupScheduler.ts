import fs from "fs";
import path from "path";
import { prisma } from "../db";
import { resolveDbPath, resolveDataDir } from "./dbPath";
import { sendEmail } from "./notifier";

// resolveDataDir(), not a hardcoded "../../data": on Docker they coincide,
// but on the native Windows/Linux installs the actual data dir is
// elsewhere (/var/lib/racktemp/data, %ProgramData%\RackTemp\data) — the
// hardcoded path was writing scheduled backups outside it there.
export const BACKUPS_DIR = path.join(resolveDataDir(), "backups");
fs.mkdirSync(BACKUPS_DIR, { recursive: true });

const CHECK_INTERVAL_MS = 15 * 60 * 1000;

export async function getBackupSettings() {
  return prisma.backupSettings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });
}

export function listBackups() {
  return fs
    .readdirSync(BACKUPS_DIR)
    .filter((f) => f.endsWith(".sqlite"))
    .map((name) => {
      const stat = fs.statSync(path.join(BACKUPS_DIR, name));
      return { name, size: stat.size, createdAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function pruneOldBackups(retentionCount: number) {
  const files = listBackups();
  for (const file of files.slice(retentionCount)) {
    fs.unlinkSync(path.join(BACKUPS_DIR, file.name));
  }
}

// Used both by the scheduler and by the "Backup now" button in Settings:
// same logic, the only difference is who calls it.
export async function performBackup(emailIt: boolean): Promise<{ name: string } | null> {
  const dbPath = resolveDbPath();
  if (!dbPath || !fs.existsSync(dbPath)) return null;

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const name = `racktemp-backup-${stamp}.sqlite`;
  const dest = path.join(BACKUPS_DIR, name);
  fs.copyFileSync(dbPath, dest);

  const settings = await getBackupSettings();
  await prisma.backupSettings.update({ where: { id: 1 }, data: { lastBackupAt: new Date() } });
  pruneOldBackups(settings.retentionCount);

  if (emailIt) {
    await sendEmail(
      "RackTemp — settings backup",
      `Automatic backup attached (${name}). Contains sensors, thresholds, notifications and login — not the full historical readings if you have retention enabled.`,
      [{ filename: name, path: dest }]
    );
  }

  return { name };
}

export function startBackupScheduler() {
  setInterval(async () => {
    const settings = await getBackupSettings();
    if (!settings.enabled) return;

    const dueAt = settings.lastBackupAt
      ? settings.lastBackupAt.getTime() + settings.intervalHours * 3600_000
      : 0;
    if (Date.now() < dueAt) return;

    try {
      await performBackup(settings.emailOnBackup);
    } catch (err) {
      console.error("[backup] scheduled backup failed", err);
    }
  }, CHECK_INTERVAL_MS);
}
