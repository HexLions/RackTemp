import { prisma } from "../db";

const RETENTION_DAYS = Number(process.env.READING_RETENTION_DAYS) || 90;
const CHECK_INTERVAL_MS = 24 * 3600_000;

async function pruneOldReadings() {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 3600_000);
  const result = await prisma.reading.deleteMany({ where: { createdAt: { lt: cutoff } } });
  if (result.count > 0) {
    console.log(`[retention] pruned ${result.count} readings older than ${RETENTION_DAYS}d`);
  }
}

// Keeps the readings table from growing forever on a long-running self-hosted
// instance. Runs once at boot and then daily. Override with
// READING_RETENTION_DAYS if 90 days of history isn't what you want.
export function startRetentionWatcher() {
  pruneOldReadings().catch((err) => console.error("retention prune failed", err));
  setInterval(() => {
    pruneOldReadings().catch((err) => console.error("retention prune failed", err));
  }, CHECK_INTERVAL_MS);
}
