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

async function lastAlertTypeAmong(sensorId: string, types: string[]): Promise<string | null> {
  const last = await prisma.notificationLog.findFirst({
    where: { sensorId, type: { in: types } },
    orderBy: { sentAt: "desc" },
  });
  return last?.type ?? null;
}

interface MetricCheck {
  sensorId: string;
  sensorName: string;
  value: number;
  min: number | null;
  max: number | null;
  hysteresis: number;
  cooldownMin: number;
  label: string;
  unit: string;
  highType: string;
  lowType: string;
  recoveredType: string;
}

// Shared high/low/recovered logic for one metric (temperature or humidity) on
// one sensor, so both can breach and recover independently in the same reading.
async function evaluateMetric(m: MetricCheck) {
  const { sensorId, sensorName, value, min, max, hysteresis, cooldownMin, label, unit, highType, lowType, recoveredType } = m;
  const isHigh = max !== null && value > max;
  const isLow = min !== null && value < min;

  if (isHigh) {
    if (!(await recentlyNotified(sensorId, highType, cooldownMin))) {
      const msg = `[${sensorName}] ${label} alta: ${value.toFixed(1)}${unit} (soglia max ${max}${unit})`;
      await notifyAll(`Rack Temp - ALERT ${sensorName}`, msg);
      await logNotification(sensorId, highType, msg);
    }
    return;
  }

  if (isLow) {
    if (!(await recentlyNotified(sensorId, lowType, cooldownMin))) {
      const msg = `[${sensorName}] ${label} bassa: ${value.toFixed(1)}${unit} (soglia min ${min}${unit})`;
      await notifyAll(`Rack Temp - ALERT ${sensorName}`, msg);
      await logNotification(sensorId, lowType, msg);
    }
    return;
  }

  const backInRange =
    (max === null || value <= max - hysteresis) && (min === null || value >= min + hysteresis);

  // Include recoveredType in the lookup: otherwise the most recent row stays
  // "high"/"low" forever once a breach happened, and every single in-range
  // reading after that re-fires a recovery notification instead of once.
  const last = await lastAlertTypeAmong(sensorId, [highType, lowType, recoveredType]);
  if (backInRange && (last === highType || last === lowType)) {
    const msg = `[${sensorName}] ${label} rientrata nella norma: ${value.toFixed(1)}${unit}`;
    await notifyAll(`Rack Temp - OK ${sensorName}`, msg);
    await logNotification(sensorId, recoveredType, msg);
  }
}

function isMuted(mutedUntil: Date | null): boolean {
  return !!mutedUntil && mutedUntil.getTime() > Date.now();
}

export async function checkReading(sensorId: string, temperature: number, humidity?: number | null) {
  const threshold = await prisma.threshold.findUnique({ where: { sensorId } });
  const sensor = await prisma.sensor.findUnique({ where: { id: sensorId } });
  if (!threshold || !threshold.enabled || !sensor) return;
  if (isMuted(threshold.mutedUntil)) return;

  await evaluateMetric({
    sensorId,
    sensorName: sensor.name,
    value: temperature,
    min: threshold.minTemp,
    max: threshold.maxTemp,
    hysteresis: threshold.hysteresis,
    cooldownMin: threshold.cooldownMin,
    label: "Temperatura",
    unit: "°C",
    highType: "high_temp",
    lowType: "low_temp",
    recoveredType: "recovered_temp",
  });

  if (humidity != null && (threshold.minHumidity !== null || threshold.maxHumidity !== null)) {
    await evaluateMetric({
      sensorId,
      sensorName: sensor.name,
      value: humidity,
      min: threshold.minHumidity,
      max: threshold.maxHumidity,
      hysteresis: threshold.hysteresis,
      cooldownMin: threshold.cooldownMin,
      label: "Umidità",
      unit: "%",
      highType: "high_humidity",
      lowType: "low_humidity",
      recoveredType: "recovered_humidity",
    });
  }
}

async function checkOffline() {
  const sensors = await prisma.sensor.findMany({ include: { threshold: true } });
  for (const sensor of sensors) {
    const t = sensor.threshold;
    if (!t || !t.enabled || isMuted(t.mutedUntil)) continue;

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
