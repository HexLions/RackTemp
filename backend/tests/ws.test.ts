import http from "http";
import type { AddressInfo } from "net";
import request from "supertest";
import { WebSocket } from "ws";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db";
import { broadcastReading, initWs, revalidateClients } from "../src/ws";
import { ADMIN_PASSWORD, ADMIN_USERNAME, buildApp, createAdmin, createViewer, resetDb } from "./helpers";

const app = buildApp();
const server = http.createServer(app);
let url: string;

beforeAll(async () => {
  initWs(server, "test-session-secret");
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(resetDb);

// The session cookies set by a login response, as one Cookie header.
async function cookieFor(path: string, username: string, password: string) {
  const res = await request(app).post(path).send({ username, password });
  expect(res.status).toBe(200);
  const setCookie = res.headers["set-cookie"] as unknown as string[];
  return setCookie.map((c) => c.split(";")[0]).join("; ");
}

// Resolves with "open" or the HTTP status the handshake was refused with.
function connect(cookie?: string): Promise<{ ws: WebSocket; result: "open" | number }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, { headers: cookie ? { cookie } : {} });
    ws.on("open", () => resolve({ ws, result: "open" }));
    ws.on("unexpected-response", (_req, res) => resolve({ ws, result: res.statusCode ?? 0 }));
  });
}

function nextClose(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => ws.on("close", (code) => resolve(code)));
}

describe("WebSocket sessions", () => {
  it("refuses a connection without a session", async () => {
    expect((await connect()).result).toBe(401);
  });

  it("lets an admin connect and receive readings", async () => {
    await createAdmin();
    const { ws, result } = await connect(await cookieFor("/api/auth/login", ADMIN_USERNAME, ADMIN_PASSWORD));
    expect(result).toBe("open");

    const message = new Promise<string>((resolve) => ws.on("message", (data) => resolve(data.toString())));
    broadcastReading("sensor-1", { temperature: 21.5 });
    expect(JSON.parse(await message)).toMatchObject({ type: "reading", sensorId: "sensor-1" });
    ws.close();
  });

  it("refuses an admin that hasn't finished first-boot setup", async () => {
    await createAdmin({ mustChangePassword: true });
    const { result } = await connect(await cookieFor("/api/auth/login", ADMIN_USERNAME, ADMIN_PASSWORD));
    expect(result).toBe(401);
  });

  it("lets viewers connect, checked against their own account", async () => {
    await createAdmin({ sessionEpoch: 5 });
    await createViewer("viewer1", "viewer-password"); // id 1, same as the admin
    await createViewer("viewer2", "viewer-password");
    for (const name of ["viewer1", "viewer2"]) {
      const { ws, result } = await connect(await cookieFor("/api/auth/viewer-login", name, "viewer-password"));
      expect(result).toBe("open");
      ws.close();
    }
  });

  it("closes an admin connection once its session is revoked", async () => {
    await createAdmin();
    const { ws } = await connect(await cookieFor("/api/auth/login", ADMIN_USERNAME, ADMIN_PASSWORD));
    const closed = nextClose(ws);

    await revalidateClients();
    expect(ws.readyState).toBe(WebSocket.OPEN);

    await prisma.adminUser.update({ where: { id: 1 }, data: { sessionEpoch: { increment: 1 } } });
    await revalidateClients();
    expect(await closed).toBe(4001);
  });

  it("closes a viewer connection once the viewer is deleted", async () => {
    await createAdmin();
    const viewer = await createViewer("viewer1", "viewer-password");
    const { ws } = await connect(await cookieFor("/api/auth/viewer-login", "viewer1", "viewer-password"));
    const closed = nextClose(ws);

    await prisma.viewerUser.delete({ where: { id: viewer.id } });
    await revalidateClients();
    expect(await closed).toBe(4001);
  });
});
