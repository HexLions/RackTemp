import fs from "fs";
import path from "path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient, prisma } from "../src/db";
import { resetDb } from "./helpers";

beforeEach(resetDb);

describe("DateTime storage", () => {
  // Databases created before the Prisma 7 upgrade hold DateTime columns as
  // integer milliseconds. Reading them as ISO text would turn every
  // timestamp into garbage and break retention and session checks.
  it("reads a date stored by Prisma 5 as integer milliseconds", async () => {
    const sensor = await prisma.sensor.create({ data: { name: "rack-a", apiKey: "k1" } });
    await prisma.$executeRaw`UPDATE Sensor SET keyHandoutUntil = ${1792836000123} WHERE id = ${sensor.id}`;

    const read = await prisma.sensor.findUniqueOrThrow({ where: { id: sensor.id } });
    expect(read.keyHandoutUntil?.toISOString()).toBe("2026-10-24T10:00:00.123Z");
  });

  it("writes new dates in that same integer format", async () => {
    const when = new Date("2026-10-24T10:00:00.123Z");
    const sensor = await prisma.sensor.create({ data: { name: "rack-a", apiKey: "k1", keyHandoutUntil: when } });

    const [row] = await prisma.$queryRaw<{ kind: string; value: bigint }[]>`
      SELECT typeof(keyHandoutUntil) AS kind, keyHandoutUntil AS value FROM Sensor WHERE id = ${sensor.id}`;
    expect(row.kind).toBe("integer");
    expect(Number(row.value)).toBe(when.getTime());
  });
});

describe("createPrismaClient", () => {
  const dir = path.join(process.env.RACKTEMP_TEST_DATA_DIR!, "db-test");
  fs.mkdirSync(dir, { recursive: true });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  // The restore-backup route opens the uploaded file this way to check
  // that it is a RackTemp database before copying it over the real one.
  it("fails on a file that is not a SQLite database", async () => {
    const file = path.join(dir, "junk.sqlite");
    fs.writeFileSync(file, Buffer.alloc(4096, 1));
    const client = createPrismaClient(file);
    await expect(client.adminUser.findFirst()).rejects.toThrow();
    await client.$disconnect();
  });

  it("opens a copy of a real RackTemp database", async () => {
    const file = path.join(dir, "copy.sqlite");
    await prisma.$executeRawUnsafe(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    const client = createPrismaClient(file);
    await expect(client.adminUser.findFirst()).resolves.toBeNull();
    await client.$disconnect();
  });
});
