import { Router } from "express";
import { prisma } from "../db";

export const prtgRouter = Router();

// Controller-wide PRTG sensor: ONE "HTTP Data Advanced" sensor in PRTG hitting
// this URL (with the integration token as ?key=...) gets every configured
// rack sensor back as channels, instead of creating one PRTG sensor per
// device. Registered before "/:sensorId" so "all" isn't swallowed as an id.
prtgRouter.get("/all", async (req, res) => {
  const key = req.query.key as string | undefined;
  const settings = await prisma.integrationSettings.findUnique({ where: { id: 1 } });

  if (!settings || !key || settings.prtgToken !== key) {
    return res.status(401).json({ prtg: { error: 1, text: "invalid integration token" } });
  }

  const sensors = await prisma.sensor.findMany({
    include: { readings: { orderBy: { createdAt: "desc" }, take: 1 } },
    orderBy: { name: "asc" },
  });

  const result: any[] = [];
  for (const sensor of sensors) {
    const reading = sensor.readings[0];
    if (!reading) continue;

    const ageMin = (Date.now() - reading.createdAt.getTime()) / 60_000;
    result.push({
      channel: `${sensor.name} - Temperature`,
      value: reading.temperature,
      float: 1,
      unit: "Custom",
      customunit: "°C",
    });
    result.push({ channel: `${sensor.name} - Age`, value: Math.round(ageMin), unit: "Custom", customunit: "min" });
    if (reading.humidity !== null) {
      result.push({ channel: `${sensor.name} - Humidity`, value: reading.humidity, float: 1, unit: "Percent" });
    }
  }

  if (result.length === 0) {
    return res.json({ prtg: { error: 1, text: "no readings yet on any sensor" } });
  }

  res.json({ prtg: { result } });
});

// Legacy per-sensor endpoint, kept for setups that prefer one PRTG sensor per
// device: GET with the sensor's own apiKey as ?key=...
prtgRouter.get("/:sensorId", async (req, res) => {
  const sensor = await prisma.sensor.findUnique({ where: { id: req.params.sensorId } });
  const key = req.query.key as string | undefined;

  if (!sensor || !key || sensor.apiKey !== key) {
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
    { channel: "Temperature", value: reading.temperature, float: 1, unit: "Custom", customunit: "°C" },
    { channel: "Age", value: Math.round(ageMin), unit: "Custom", customunit: "min" },
  ];
  if (reading.humidity !== null) {
    result.push({ channel: "Humidity", value: reading.humidity, float: 1, unit: "Percent" });
  }
  if (reading.rssi !== null) {
    result.push({ channel: "WiFi RSSI", value: reading.rssi, unit: "Custom", customunit: "dBm" });
  }

  res.json({ prtg: { result } });
});
