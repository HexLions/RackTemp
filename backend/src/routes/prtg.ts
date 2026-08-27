import { Router } from "express";
import { ah } from "../middleware/asyncHandler";
import { prisma } from "../db";
import { secretEquals } from "../services/secrets";

export const prtgRouter = Router();

const DEFAULT_MAX_OFFLINE_MIN = 15;

// A software-level heartbeat is more reliable than an ICMP ping here: an
// ESP32 can answer ping while stuck/not actually sending readings (or be
// unreachable by ping due to AP client isolation while still POSTing fine).
// LimitMode/LimitMinError make PRTG flag it as an error on its own, no
// manual channel-limit setup needed in PRTG — same as a ping sensor going down.
function onlineChannel(name: string, lastSeenAt: Date | null, maxOfflineMin: number) {
  const online = !!lastSeenAt && Date.now() - lastSeenAt.getTime() <= maxOfflineMin * 60_000;
  return {
    channel: name,
    value: online ? 1 : 0,
    LimitMode: 1,
    LimitMinError: 1,
    LimitErrorMsg: "Sensor offline - no reading received within the configured timeout",
  };
}

// Carries the same min/max thresholds already configured for this sensor in
// RackTemp over to the PRTG channel's own limits, so PRTG raises the alert
// on its own — no need to duplicate the same numbers again in PRTG's UI.
function withThresholdLimits<T extends Record<string, unknown>>(
  channel: T,
  min: number | null | undefined,
  max: number | null | undefined
): T {
  if (min == null && max == null) return channel;
  return {
    ...channel,
    LimitMode: 1,
    ...(min != null ? { LimitMinError: min } : {}),
    ...(max != null ? { LimitMaxError: max } : {}),
  };
}

// Controller-wide PRTG sensor: ONE "HTTP Data Advanced" sensor in PRTG hitting
// this URL (with the integration token as ?key=...) gets every configured
// rack sensor back as channels, instead of creating one PRTG sensor per
// device. Registered before "/:sensorId" so "all" isn't swallowed as an id.
prtgRouter.get("/all", ah(async (req, res) => {
  const key = req.query.key as string | undefined;
  const settings = await prisma.integrationSettings.findUnique({ where: { id: 1 } });

  if (!settings || !secretEquals(settings.prtgToken, key)) {
    return res.status(401).json({ prtg: { error: 1, text: "invalid integration token" } });
  }

  const sensors = await prisma.sensor.findMany({
    include: { readings: { orderBy: { createdAt: "desc" }, take: 1 }, threshold: true },
    orderBy: { name: "asc" },
  });

  const result: any[] = [];
  for (const sensor of sensors) {
    const reading = sensor.readings[0];
    if (!reading) continue;

    const ageMin = (Date.now() - reading.createdAt.getTime()) / 60_000;
    result.push(
      withThresholdLimits(
        {
          channel: `${sensor.name} - Temperature`,
          value: reading.temperature,
          float: 1,
          unit: "Custom",
          customunit: "C",
        },
        sensor.threshold?.minTemp,
        sensor.threshold?.maxTemp
      )
    );
    result.push({ channel: `${sensor.name} - Age`, value: Math.round(ageMin), unit: "Custom", customunit: "min" });
    if (reading.humidity !== null) {
      result.push(
        withThresholdLimits(
          { channel: `${sensor.name} - Humidity`, value: reading.humidity, float: 1, unit: "Percent" },
          sensor.threshold?.minHumidity,
          sensor.threshold?.maxHumidity
        )
      );
    }
    result.push(
      onlineChannel(`${sensor.name} - Online`, sensor.lastSeenAt, sensor.threshold?.maxOfflineMin ?? DEFAULT_MAX_OFFLINE_MIN)
    );
  }

  if (result.length === 0) {
    return res.json({ prtg: { error: 1, text: "no readings yet on any sensor" } });
  }

  res.json({ prtg: { result } });
}));

// Legacy per-sensor endpoint, kept for setups that prefer one PRTG sensor per
// device: GET with the sensor's own apiKey as ?key=...
prtgRouter.get("/:sensorId", ah(async (req, res) => {
  const sensor = await prisma.sensor.findUnique({
    where: { id: req.params.sensorId },
    include: { threshold: true },
  });
  const key = req.query.key as string | undefined;

  if (!sensor || !secretEquals(sensor.apiKey, key)) {
    return res.status(401).json({ prtg: { error: 1, text: "invalid sensor or key" } });
  }

  const reading = await prisma.reading.findFirst({
    where: { sensorId: sensor.id },
    orderBy: { createdAt: "desc" },
  });

  if (!reading) {
    return res.json({ prtg: { error: 1, text: "no readings yet" } });
  }

  const ageMin = (Date.now() - reading.createdAt.getTime()) / 60_000;
  const result: any[] = [
    withThresholdLimits(
      { channel: "Temperature", value: reading.temperature, float: 1, unit: "Custom", customunit: "C" },
      sensor.threshold?.minTemp,
      sensor.threshold?.maxTemp
    ),
    { channel: "Age", value: Math.round(ageMin), unit: "Custom", customunit: "min" },
    onlineChannel("Online", sensor.lastSeenAt, sensor.threshold?.maxOfflineMin ?? DEFAULT_MAX_OFFLINE_MIN),
  ];
  if (reading.humidity !== null) {
    result.push(
      withThresholdLimits(
        { channel: "Humidity", value: reading.humidity, float: 1, unit: "Percent" },
        sensor.threshold?.minHumidity,
        sensor.threshold?.maxHumidity
      )
    );
  }
  if (reading.rssi !== null) {
    result.push({ channel: "WiFi RSSI", value: reading.rssi, unit: "Custom", customunit: "dBm" });
  }

  res.json({ prtg: { result } });
}));
