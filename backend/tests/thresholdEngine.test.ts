import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/db";
import { notifyAll } from "../src/services/notifier";
import { checkReading } from "../src/services/thresholdEngine";
import { resetDb } from "./helpers";

// Hoisted above the imports by vitest: no e-mail/Telegram is ever sent.
vi.mock("../src/services/notifier", () => ({ notifyAll: vi.fn(async () => {}) }));

let sensorId: string;

async function sent() {
  return (await prisma.notificationLog.findMany({ orderBy: { sentAt: "asc" } })).map((n) => n.type);
}

beforeEach(async () => {
  await resetDb();
  vi.mocked(notifyAll).mockClear();
  const sensor = await prisma.sensor.create({ data: { name: "rack-a", apiKey: "k" } });
  sensorId = sensor.id;
  await prisma.threshold.create({
    data: { sensorId, minTemp: 15, maxTemp: 30, minHumidity: 20, maxHumidity: 70, hysteresis: 1, cooldownMin: 15 },
  });
});

describe("threshold engine", () => {
  it("stays quiet inside the range", async () => {
    await checkReading(sensorId, 22, 45);
    expect(notifyAll).not.toHaveBeenCalled();
  });

  it("alerts once on a high temperature, then respects the cooldown", async () => {
    await checkReading(sensorId, 31);
    await checkReading(sensorId, 32);
    expect(await sent()).toEqual(["high_temp"]);
    expect(notifyAll).toHaveBeenCalledTimes(1);
  });

  it("alerts on a low temperature", async () => {
    await checkReading(sensorId, 14);
    expect(await sent()).toEqual(["low_temp"]);
  });

  it("needs the hysteresis margin before sending a recovery, and sends it once", async () => {
    await checkReading(sensorId, 31);
    await checkReading(sensorId, 29.5); // below max but inside the 1° hysteresis
    expect(await sent()).toEqual(["high_temp"]);
    await checkReading(sensorId, 28.5);
    await checkReading(sensorId, 25);
    expect(await sent()).toEqual(["high_temp", "recovered_temp"]);
  });

  it("checks humidity independently of temperature", async () => {
    await checkReading(sensorId, 22, 75);
    expect(await sent()).toEqual(["high_humidity"]);
  });

  it("does nothing while muted or disabled", async () => {
    await prisma.threshold.update({ where: { sensorId }, data: { mutedUntil: new Date(Date.now() + 60_000) } });
    await checkReading(sensorId, 40);
    await prisma.threshold.update({ where: { sensorId }, data: { mutedUntil: null, enabled: false } });
    await checkReading(sensorId, 40);
    expect(notifyAll).not.toHaveBeenCalled();
  });
});
