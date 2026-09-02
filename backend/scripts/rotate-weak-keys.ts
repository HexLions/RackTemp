// Rotates any Sensor.apiKey / IntegrationSettings.prtgToken still using the
// old cuid-based format (weak as credential material — see the schema
// comments) to a cryptographically random 32-byte hex string. Safe to run
// repeatedly: only touches values that still match the cuid pattern, so an
// already-rotated key is left alone.
//
// Run with: npm run rotate-keys
//
// After running, every printed sensor needs its new key pasted into the
// device's setup portal (hold BOOT for 2s after boot to reopen it).

import { randomBytes } from "crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// cuid v1 format: 'c' followed by 24 base36 chars (25 chars total).
const CUID_PATTERN = /^c[a-z0-9]{24}$/;

async function main() {
  const sensors = await prisma.sensor.findMany({
    where: { apiKey: { not: undefined } },
    select: { id: true, name: true, apiKey: true },
  });

  const rotatedSensors: { name: string; newKey: string }[] = [];
  for (const sensor of sensors) {
    if (!CUID_PATTERN.test(sensor.apiKey)) continue;
    const newKey = randomBytes(32).toString("hex");
    await prisma.sensor.update({ where: { id: sensor.id }, data: { apiKey: newKey } });
    rotatedSensors.push({ name: sensor.name, newKey });
  }

  const settings = await prisma.integrationSettings.findUnique({ where: { id: 1 } });
  let rotatedPrtgToken: string | null = null;
  if (settings && CUID_PATTERN.test(settings.prtgToken)) {
    rotatedPrtgToken = randomBytes(32).toString("hex");
    await prisma.integrationSettings.update({ where: { id: 1 }, data: { prtgToken: rotatedPrtgToken } });
  }

  if (rotatedSensors.length === 0 && !rotatedPrtgToken) {
    console.log("Nothing to rotate — all keys already look cryptographically random.");
    return;
  }

  if (rotatedSensors.length > 0) {
    console.log("\nSensor API keys rotated — paste the new key into each device's setup portal:\n");
    for (const s of rotatedSensors) {
      console.log(`  ${s.name}\n    ${s.newKey}\n`);
    }
  }

  if (rotatedPrtgToken) {
    console.log(`PRTG integration token rotated — update it in your PRTG sensor URL(s):\n\n  ${rotatedPrtgToken}\n`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
