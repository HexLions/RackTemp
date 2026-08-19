import { prisma } from "../db";
import { notifyAll } from "./notifier";

const OFFLINE_CHECK_INTERVAL_MS = 60_000;

async function recentlyNotified(sensorId: string, type: string, cooldownMin: number) {
  const since = new Date(Date.now() - cooldownMin * 60_000);
  const last = await prisma.notificationLog.findFirst({
    where: { sensorId, type, sentAt: { gte: since } },
    orderBy: { sentAt: "desc" },
  });
  return !!last;
}

async function logNotification(sensorId: string, type: string, message: string) {
  await prisma.notificationLog.create({ data: { sensorId, type, message } });
}

async function lastAlertType(sensorId: string): Promise<string | null> {
  const last = await prisma.notificationLog.findFirst({
    where: { sensorId },
    orderBy: { sentAt: "desc" },
  });
  return last?.type ?? null;
}

export async function checkReading(sensorId: string, temperature: number) {
  const threshold = await prisma.threshold.findUnique({ where: { sensorId } });
  const sensor = await prisma.sensor.findUnique({ where: { id: sensorId } });
  if (!threshold || !threshold.enabled || !sensor) return;

  const { minTemp, maxTemp, hysteresis, cooldownMin } = threshold;
  const isHigh = maxTemp !== null && temperature > maxTemp;
  const isLow = minTemp !== null && temperature < minTemp;
  const last = await lastAlertType(sensorId);

  if (isHigh) {
    if (!(await recentlyNotified(sensorId, "high_temp", cooldownMin))) {
      const msg = `[${sensor.name}] Temperatura alta: ${temperature.toFixed(1)}°C (soglia max ${maxTemp}°C)`;
      await notifyAll(`Rack Temp - ALERT ${sensor.name}`, msg);
      await logNotification(sensorId, "high_temp", msg);
    }
    return;
  }

  if (isLow) {
    if (!(await recentlyNotified(sensorId, "low_temp", cooldownMin))) {
      const msg = `[${sensor.name}] Temperatura bassa: ${temperature.toFixed(1)}°C (soglia min ${minTemp}°C)`;
      await notifyAll(`Rack Temp - ALERT ${sensor.name}`, msg);
      await logNotification(sensorId, "low_temp", msg);
    }
    return;
  }

  // Back within thresholds (with hysteresis margin) after a previous alert -> send recovery once.
  const backInRange =
    (maxTemp === null || temperature <= maxTemp - hysteresis) &&
    (minTemp === null || temperature >= minTemp + hysteresis);

  if (backInRange && (last === "high_temp" || last === "low_temp")) {
    const msg = `[${sensor.name}] Temperatura rientrata nella norma: ${temperature.toFixed(1)}°C`;
    await notifyAll(`Rack Temp - OK ${sensor.name}`, msg);
    await logNotification(sensorId, "recovered", msg);
  }
}

async function checkOffline() {
  const sensors = await prisma.sensor.findMany({ include: { threshold: true } });
  for (const sensor of sensors) {
    const t = sensor.threshold;
    if (!t || !t.enabled) continue;

    const offlineSince = sensor.lastSeenAt
      ? Date.now() - sensor.lastSeenAt.getTime()
      : Infinity;
    const isOffline = offlineSince > t.maxOfflineMin * 60_000;
    const last = await lastAlertType(sensor.id);

    if (isOffline && last !== "offline") {
      const msg = `[${sensor.name}] Sensore offline da oltre ${t.maxOfflineMin} minuti`;
      await notifyAll(`Rack Temp - OFFLINE ${sensor.name}`, msg);
      await logNotification(sensor.id, "offline", msg);
    } else if (!isOffline && last === "offline") {
      const msg = `[${sensor.name}] Sensore tornato online`;
      await notifyAll(`Rack Temp - OK ${sensor.name}`, msg);
      await logNotification(sensor.id, "recovered", msg);
    }
  }
}

export function startOfflineWatcher() {
  setInterval(() => {
    checkOffline().catch((err) => console.error("offline check failed", err));
  }, OFFLINE_CHECK_INTERVAL_MS);
}
