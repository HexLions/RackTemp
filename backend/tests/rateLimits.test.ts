import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { ADMIN_PASSWORD, ADMIN_USERNAME, buildApp, createAdmin, resetDb } from "./helpers";

beforeEach(async () => {
  await resetDb();
  await createAdmin();
});

// A fresh app per test: each one gets its own limiter store.
async function loginAdmin(app: ReturnType<typeof buildApp>) {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/login").send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
  expect(res.status).toBe(200);
  return agent;
}

describe("login limiter", () => {
  it("answers 429 after 10 attempts", async () => {
    const app = buildApp({ rateLimits: true });
    for (let i = 0; i < 10; i++) {
      const res = await request(app).post("/api/auth/login").send({ username: ADMIN_USERNAME, password: "wrong-password" });
      expect(res.status).toBe(401);
    }
    const res = await request(app).post("/api/auth/login").send({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
    expect(res.status).toBe(429);
  });
});

describe("re-authentication limiter", () => {
  it("answers 429 after 10 wrong passwords across the session routes, even with the right one", async () => {
    const app = buildApp({ rateLimits: true });
    const agent = await loginAdmin(app);
    const wrong = { currentPassword: "wrong-password" };
    const attempts = [
      () => agent.post("/api/auth/change-password").send({ ...wrong, newPassword: "attacker-password" }),
      () => agent.post("/api/auth/mfa/disable").send(wrong),
      () => agent.post("/api/auth/regenerate-recovery-key").send(wrong),
      () => agent.post("/api/auth/mfa/enable").send({ code: "123456" }),
    ];
    for (let i = 0; i < 10; i++) {
      const res = await attempts[i % attempts.length]();
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).not.toBe(429);
    }

    const res = await agent.post("/api/auth/regenerate-recovery-key").send({ currentPassword: ADMIN_PASSWORD });
    expect(res.status).toBe(429);
  });

  it("doesn't count successful requests", async () => {
    const app = buildApp({ rateLimits: true });
    const agent = await loginAdmin(app);
    for (let i = 0; i < 11; i++) {
      const res = await agent.post("/api/auth/regenerate-recovery-key").send({ currentPassword: ADMIN_PASSWORD });
      expect(res.status).toBe(200);
    }
  });

  it("leaves routes without a password check alone", async () => {
    const app = buildApp({ rateLimits: true });
    const agent = await loginAdmin(app);
    for (let i = 0; i < 10; i++) {
      await agent.post("/api/auth/regenerate-recovery-key").send({ currentPassword: "wrong-password" });
    }
    expect((await agent.get("/api/auth/viewers")).status).toBe(200);
    expect((await agent.get("/api/auth/mfa/status")).status).toBe(200);
  });
});
