import bcrypt from "bcryptjs";
import { generate as generateTotp } from "otplib";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db";
import { decryptField, encryptField } from "../src/services/fieldEncryption";
import { ADMIN_PASSWORD, ADMIN_USERNAME, buildApp, createAdmin, createViewer, resetDb } from "./helpers";

const app = buildApp();

async function loginAdmin() {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/login").send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
  expect(res.status).toBe(200);
  return agent;
}

beforeEach(resetDb);

describe("admin login", () => {
  beforeEach(() => createAdmin());

  it("rejects a wrong password and records the failure", async () => {
    const res = await request(app).post("/api/auth/login").send({ username: ADMIN_USERNAME, password: "wrong-password" });
    expect(res.status).toBe(401);
    expect(await prisma.auditLog.count({ where: { action: "login_failed" } })).toBe(1);
  });

  it("rejects an unknown username with the same error", async () => {
    const res = await request(app).post("/api/auth/login").send({ username: "nobody", password: ADMIN_PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("invalid credentials");
  });

  it("rejects a malformed body", async () => {
    const res = await request(app).post("/api/auth/login").send({ username: ADMIN_USERNAME });
    expect(res.status).toBe(400);
  });

  it("opens a session that reaches admin-only routes", async () => {
    const agent = await loginAdmin();
    expect((await agent.get("/api/auth/me")).body).toMatchObject({ username: ADMIN_USERNAME, role: "admin" });
    expect((await agent.get("/api/sensors")).status).toBe(200);
  });

  it("blocks admin-only routes without a session", async () => {
    expect((await request(app).get("/api/sensors")).status).toBe(401);
    expect((await request(app).get("/api/system/backups")).status).toBe(401);
  });
});

describe("first boot (mustChangePassword)", () => {
  it("blocks the rest of the app until setup is finished", async () => {
    await createAdmin({ mustChangePassword: true, bootstrapTokenHash: await bcrypt.hash("abcd1234", 4) });
    const agent = await loginAdmin();
    const res = await agent.get("/api/sensors");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("must_change_password");
  });

  it("requires the setup token to finish setup", async () => {
    await createAdmin({ mustChangePassword: true, bootstrapTokenHash: await bcrypt.hash("abcd1234", 4) });
    const agent = await loginAdmin();

    const wrong = await agent.post("/api/auth/first-login").send({ newUsername: "owner", newPassword: "a-long-new-password", bootstrapToken: "ffffffff" });
    expect(wrong.status).toBe(401);

    const ok = await agent.post("/api/auth/first-login").send({ newUsername: "owner", newPassword: "a-long-new-password", bootstrapToken: "abcd1234" });
    expect(ok.status).toBe(200);
    expect(ok.body.recoveryKey).toMatch(/^[0-9A-F]{5}(-[0-9A-F]{5}){7}$/);

    const user = await prisma.adminUser.findUniqueOrThrow({ where: { id: 1 } });
    expect(user.bootstrapTokenHash).toBeNull();
    expect(user.recoveryKeyHash).not.toContain(ok.body.recoveryKey);
    expect(await bcrypt.compare(ok.body.recoveryKey, user.recoveryKeyHash!)).toBe(true);
    expect((await agent.get("/api/sensors")).status).toBe(200);
  });
});

describe("session revocation (sessionEpoch)", () => {
  beforeEach(() => createAdmin());

  it("change-password logs out every other session but keeps the current one", async () => {
    const stolen = await loginAdmin();
    const current = await loginAdmin();

    const res = await current.post("/api/auth/change-password").send({ currentPassword: ADMIN_PASSWORD, newPassword: "another-long-password" });
    expect(res.status).toBe(200);

    expect((await stolen.get("/api/sensors")).status).toBe(401);
    expect((await current.get("/api/sensors")).status).toBe(200);
  });

  it("change-password requires the current password", async () => {
    const agent = await loginAdmin();
    const res = await agent.post("/api/auth/change-password").send({ currentPassword: "wrong", newPassword: "another-long-password" });
    expect(res.status).toBe(401);
  });
});

describe("password reset by email token", () => {
  const token = "a".repeat(64);

  it("stores only a hash and accepts the right token once", async () => {
    await createAdmin({ resetTokenHash: await bcrypt.hash(token, 4), resetTokenExpiresAt: new Date(Date.now() + 60_000) });
    const stolen = await loginAdmin();

    const ok = await request(app).post("/api/auth/reset-password").send({ token, newPassword: "brand-new-password" });
    expect(ok.status).toBe(200);

    const user = await prisma.adminUser.findUniqueOrThrow({ where: { id: 1 } });
    expect(user.resetTokenHash).toBeNull();
    expect(await bcrypt.compare("brand-new-password", user.passwordHash)).toBe(true);
    expect((await stolen.get("/api/sensors")).status).toBe(401);

    const reuse = await request(app).post("/api/auth/reset-password").send({ token, newPassword: "yet-another-password" });
    expect(reuse.status).toBe(400);
  });

  it("rejects a wrong token", async () => {
    await createAdmin({ resetTokenHash: await bcrypt.hash(token, 4), resetTokenExpiresAt: new Date(Date.now() + 60_000) });
    const res = await request(app).post("/api/auth/reset-password").send({ token: "b".repeat(64), newPassword: "brand-new-password" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid reset link");
  });

  it("rejects an expired token", async () => {
    await createAdmin({ resetTokenHash: await bcrypt.hash(token, 4), resetTokenExpiresAt: new Date(Date.now() - 1000) });
    const res = await request(app).post("/api/auth/reset-password").send({ token, newPassword: "brand-new-password" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/expired/);
  });
});

describe("password reset by recovery key", () => {
  const recoveryKey = "AAAAA-BBBBB-CCCCC-DDDDD-EEEEE-FFFFF-00000-11111";

  it("resets the password, rotates the key, drops MFA and revokes sessions", async () => {
    await createAdmin({ recoveryKeyHash: await bcrypt.hash(recoveryKey, 4) });
    const stolen = await loginAdmin();
    await prisma.adminUser.update({ where: { id: 1 }, data: { totpEnabled: true, totpSecret: encryptField("JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP") } });

    const res = await request(app).post("/api/auth/reset-password-with-key").send({ recoveryKey, newPassword: "brand-new-password" });
    expect(res.status).toBe(200);
    expect(res.body.newRecoveryKey).not.toBe(recoveryKey);

    const user = await prisma.adminUser.findUniqueOrThrow({ where: { id: 1 } });
    expect(user.totpEnabled).toBe(false);
    expect(user.totpSecret).toBeNull();
    expect(await bcrypt.compare(res.body.newRecoveryKey, user.recoveryKeyHash!)).toBe(true);
    expect((await stolen.get("/api/sensors")).status).toBe(401);

    const reuse = await request(app).post("/api/auth/reset-password-with-key").send({ recoveryKey, newPassword: "other-long-password" });
    expect(reuse.status).toBe(400);
  });
});

describe("MFA login", () => {
  const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

  beforeEach(() => createAdmin({ totpEnabled: true, totpSecret: encryptField(secret) }));

  it("keeps the session unauthenticated until the TOTP code is checked", async () => {
    const agent = request.agent(app);
    const res = await agent.post("/api/auth/login").send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    expect(res.body).toMatchObject({ ok: true, mfaRequired: true });
    expect((await agent.get("/api/sensors")).status).toBe(401);

    expect((await agent.post("/api/auth/mfa/login").send({ code: "000000" })).status).toBe(401);

    const code = await generateTotp({ secret });
    expect((await agent.post("/api/auth/mfa/login").send({ code })).status).toBe(200);
    expect((await agent.get("/api/sensors")).status).toBe(200);
  });

  it("stores the TOTP secret encrypted", async () => {
    const user = await prisma.adminUser.findUniqueOrThrow({ where: { id: 1 } });
    expect(user.totpSecret).not.toContain(secret);
    expect(decryptField(user.totpSecret)).toBe(secret);
  });
});

describe("viewer accounts", () => {
  beforeEach(async () => {
    await createAdmin();
    // Same numeric id as the admin row: the role check, not the id, must
    // keep this account read-only (see middleware/auth.ts).
    await createViewer("viewer1", "viewer-password");
  });

  async function loginViewer() {
    const agent = request.agent(app);
    const res = await agent.post("/api/auth/viewer-login").send({ username: "viewer1", password: "viewer-password" });
    expect(res.status).toBe(200);
    return agent;
  }

  it("can read sensors but never sees API keys", async () => {
    await prisma.sensor.create({ data: { name: "rack-a", apiKey: "secret-sensor-key" } });
    const viewer = await loginViewer();
    const res = await viewer.get("/api/sensors");
    expect(res.status).toBe(200);
    expect(res.body[0].name).toBe("rack-a");
    expect(res.body[0]).not.toHaveProperty("apiKey");
  });

  it("cannot reach admin-only routes despite sharing id 1 with the admin", async () => {
    const viewer = await loginViewer();
    expect((await viewer.post("/api/sensors").send({ name: "x" })).status).toBe(401);
    expect((await viewer.get("/api/system/backups")).status).toBe(401);
  });

  it("is logged out when the admin resets its password", async () => {
    const viewer = await loginViewer();
    const admin = await loginAdmin();
    const v = await prisma.viewerUser.findUniqueOrThrow({ where: { username: "viewer1" } });
    expect((await admin.post(`/api/auth/viewers/${v.id}/reset-password`).send({ password: "new-viewer-password" })).status).toBe(200);
    expect((await viewer.get("/api/sensors")).status).toBe(401);
  });
});

// Every admin route in auth.ts must honour sessionEpoch like requireAuth
// does (see middleware/auth.ts), not just session.userId and role.
describe("revoked sessions on auth routes", () => {
  beforeEach(() => createAdmin());

  async function revokedSession() {
    const stolen = await loginAdmin();
    const admin = await loginAdmin();
    const res = await admin.post("/api/auth/change-password").send({ currentPassword: ADMIN_PASSWORD, newPassword: "another-long-password" });
    expect(res.status).toBe(200);
    return stolen;
  }

  it.each([
    ["get", "/api/auth/me", {}],
    ["get", "/api/auth/mfa/status", {}],
    ["post", "/api/auth/mfa/setup", {}],
    ["post", "/api/auth/mfa/enable", { code: "123456" }],
    ["post", "/api/auth/mfa/disable", { currentPassword: "another-long-password" }],
    ["post", "/api/auth/change-password", { currentPassword: "another-long-password", newPassword: "attacker-password" }],
    ["post", "/api/auth/regenerate-recovery-key", { currentPassword: "another-long-password" }],
    ["get", "/api/auth/viewers", {}],
    ["post", "/api/auth/viewers", { username: "extra-viewer", password: "extra-viewer-pass" }],
    ["post", "/api/auth/viewers/1/reset-password", { password: "extra-viewer-pass" }],
    ["delete", "/api/auth/viewers/1", {}],
  ] as const)("%s %s answers 401", async (method, url, body) => {
    const stolen = await revokedSession();
    const res = await stolen[method](url).send(body);
    expect(res.status).toBe(401);
  });

  it("leaves viewers and MFA settings untouched", async () => {
    const stolen = await revokedSession();
    await stolen.post("/api/auth/viewers").send({ username: "extra-viewer", password: "extra-viewer-pass" });
    await stolen.post("/api/auth/mfa/setup").send({});

    expect(await prisma.viewerUser.count()).toBe(0);
    const user = await prisma.adminUser.findUniqueOrThrow({ where: { id: 1 } });
    expect(user.totpSecret).toBeNull();
    expect(user.totpEnabled).toBe(false);
  });

  it("still lets the current session use the same routes", async () => {
    const admin = await loginAdmin();
    expect((await admin.get("/api/auth/mfa/status")).status).toBe(200);
    expect((await admin.post("/api/auth/viewers").send({ username: "viewer2", password: "viewer-password" })).status).toBe(200);
  });

  it("logs a revoked viewer out of /me", async () => {
    const v = await createViewer("viewer1", "viewer-password");
    const viewer = request.agent(app);
    await viewer.post("/api/auth/viewer-login").send({ username: "viewer1", password: "viewer-password" });
    await prisma.viewerUser.update({ where: { id: v.id }, data: { sessionEpoch: { increment: 1 } } });
    expect((await viewer.get("/api/auth/me")).status).toBe(401);
  });
});

describe("revoked sessions during first boot", () => {
  beforeEach(() => createAdmin({ mustChangePassword: true, bootstrapTokenHash: bcrypt.hashSync("abcd1234", 4) }));

  it("first-login rejects a revoked session even with the right token", async () => {
    const agent = await loginAdmin();
    await prisma.adminUser.update({ where: { id: 1 }, data: { sessionEpoch: { increment: 1 } } });
    const res = await agent.post("/api/auth/first-login").send({ newUsername: "owner", newPassword: "a-long-new-password", bootstrapToken: "abcd1234" });
    expect(res.status).toBe(401);
  });

  it("restore-backup rejects a revoked session before writing the upload", async () => {
    const agent = await loginAdmin();
    await prisma.adminUser.update({ where: { id: 1 }, data: { sessionEpoch: { increment: 1 } } });
    const res = await agent.post("/api/auth/restore-backup").field("bootstrapToken", "abcd1234").attach("backup", Buffer.alloc(1024, 1), "backup.sqlite");
    expect(res.status).toBe(401);
  });
});
