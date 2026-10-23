import fs from "fs";
import path from "path";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { BACKUPS_DIR } from "../src/services/backupScheduler";
import { ADMIN_PASSWORD, ADMIN_USERNAME, buildApp, createAdmin, resetDb } from "./helpers";

const app = buildApp();
const restoreTmpDir = path.join(process.env.RACKTEMP_TEST_DATA_DIR!, "restore-tmp");

async function loginAdmin() {
  const agent = request.agent(app);
  await agent.post("/api/auth/login").send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
  return agent;
}

beforeEach(async () => {
  await resetDb();
  await createAdmin();
});

describe("restore-backup upload", () => {
  it("rejects an unauthenticated upload before anything reaches disk", async () => {
    const res = await request(app)
      .post("/api/auth/restore-backup")
      .attach("backup", Buffer.alloc(64 * 1024, 1), "backup.sqlite");
    expect(res.status).toBe(401);
    expect(fs.readdirSync(restoreTmpDir)).toEqual([]);
  });

  it("refuses a restore on an already configured instance and cleans up", async () => {
    const agent = await loginAdmin();
    const res = await agent
      .post("/api/auth/restore-backup")
      .field("bootstrapToken", "abcd1234")
      .attach("backup", Buffer.from("not a database"), "backup.sqlite");
    expect(res.status).toBe(403);
    // No upload file is left behind (the 403 itself now comes before multer).
    expect(fs.readdirSync(restoreTmpDir)).toEqual([]);
  });
});

describe("firmware upload", () => {
  it("answers 400, not 500, to a repeated version field", async () => {
    const agent = await loginAdmin();
    const res = await agent
      .post("/api/firmware")
      .field("version", "1.0.0")
      .field("version", "1.0.1")
      .attach("firmware", Buffer.from("bin"), "fw.bin");
    expect(res.status).toBe(400);
  });

  it("accepts a normal upload", async () => {
    const agent = await loginAdmin();
    const res = await agent.post("/api/firmware").field("version", " 2.0.0 ").attach("firmware", Buffer.from("bin"), "fw.bin");
    expect(res.status).toBe(200);
    expect(res.body.version).toBe("2.0.0");
  });
});

describe("backup download", () => {
  const name = "racktemp-backup-2026-10-23T08-00-00.sqlite";

  beforeEach(() => {
    fs.writeFileSync(path.join(BACKUPS_DIR, name), "backup bytes");
  });

  it("serves a backup by its exact name", async () => {
    const agent = await loginAdmin();
    const res = await agent.get(`/api/system/backups/${name}/download`).buffer(true);
    expect(res.status).toBe(200);
    expect(res.body.toString()).toBe("backup bytes");
  });

  it.each([
    "..%2Ftest.sqlite",
    "..%2F..%2Fetc%2Fpasswd",
    "racktemp-backup-x.sqlite%2F..%2F..%2Ftest.sqlite",
    "racktemp-backup-..%2F..%2Ftest.sqlite",
    "field-encryption-key",
  ])("rejects a name outside the backup pattern: %s", async (bad) => {
    const agent = await loginAdmin();
    const res = await agent.get(`/api/system/backups/${bad}/download`);
    expect(res.status).toBe(400);
  });

  it("returns 404 for a well-formed name that doesn't exist", async () => {
    const agent = await loginAdmin();
    const res = await agent.get("/api/system/backups/racktemp-backup-missing.sqlite/download");
    expect(res.status).toBe(404);
  });

  it("is admin-only", async () => {
    const res = await request(app).get(`/api/system/backups/${name}/download`);
    expect(res.status).toBe(401);
  });
});
