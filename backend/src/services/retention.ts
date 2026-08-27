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

// DiscoveredDevice rows (unauthenticated /api/discovery/announce upserts one
// per chipId) are never pruned anywhere else — the dashboard's "seen on the
// network" list only *filters* by lastSeenAt (services/... ACTIVE_WINDOW_MS
// in discovery.ts), it doesn't delete. A week of no announces means the
// device is gone for good (unplugged, reflashed, moved networks); keep the
// table from growing forever from stale/one-off chips.
const DISCOVERED_DEVICE_RETENTION_DAYS = 7;

async function pruneStaleDiscoveredDevices() {
  const cutoff = new Date(Date.now() - DISCOVERED_DEVICE_RETENTION_DAYS * 24 * 3600_000);
  const result = await prisma.discoveredDevice.deleteMany({ where: { lastSeenAt: { lt: cutoff } } });
  if (result.count > 0) {
    console.log(`[retention] pruned ${result.count} stale discovered devices older than ${DISCOVERED_DEVICE_RETENTION_DAYS}d`);
  }
}

// Keeps the readings table from growing forever on a long-running self-hosted
// instance. Runs once at boot and then daily. Override with
// READING_RETENTION_DAYS if 90 days of history isn't what you want.
export function startRetentionWatcher() {
  const run = () => {
    pruneOldReadings().catch((err) => console.error("retention prune failed", err));
    pruneStaleDiscoveredDevices().catch((err) => console.error("discovered-device prune failed", err));
  };
  run();
  setInterval(run, CHECK_INTERVAL_MS);
}
