import { Router } from "express";
import { prisma } from "../db";

export const prtgRouter = Router();

// PRTG "HTTP Data Advanced" / REST Custom sensor: GET this URL with the sensor's
// apiKey as ?key=... and point PRTG at channel "Temperature" (and "Humidity" if present).
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
