import { WebSocketServer, WebSocket } from "ws";
import type { Server, IncomingMessage } from "http";
import { parseCookie as parseCookies } from "cookie";
import Keygrip from "keygrip";
import { prisma } from "./db";

let wss: WebSocketServer | null = null;

interface SessionPayload {
  userId?: number;
  role?: string;
  mustChangePassword?: boolean;
  epoch?: number;
}

type Client = WebSocket & { isAlive?: boolean; session?: SessionPayload | null };

// Replicates cookie-session's own verification exactly (read from its
// source, not guessed): it stores the session as base64(JSON) in a
// `session` cookie, signed by a `session.sig` cookie whose value is
// Keygrip.sign("session=" + rawCookieValue). There's no Express
// `req.session` available yet at the WebSocket upgrade stage (no
// cookie-session middleware runs on the raw upgrade request), so this
// re-derives it from the raw Cookie header using the same libraries
// cookie-session itself uses under the hood (cookies -> keygrip), instead
// of re-implementing HMAC signing by hand.
function readSession(req: IncomingMessage, sessionSecret: string): SessionPayload | null {
  const header = req.headers.cookie;
  if (!header) return null;

  const cookies = parseCookies(header);
  const raw = cookies["session"];
  const sig = cookies["session.sig"];
  if (!raw || !sig) return null;

  const keygrip = new Keygrip([sessionSecret]);
  if (!keygrip.verify(`session=${raw}`, sig)) return null;

  try {
    return JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

// Same rules as requireAnyUser (middleware/auth.ts): an admin or a viewer,
// each checked against its own table and sessionEpoch. AdminUser and
// ViewerUser ids overlap (both start at 1), so the role decides the table.
async function isSessionCurrent(session: SessionPayload | null | undefined): Promise<boolean> {
  if (!session?.userId) return false;
  if (session.role === "admin") {
    if (session.mustChangePassword) return false;
    const user = await prisma.adminUser.findUnique({ where: { id: session.userId } });
    return !!user && session.epoch === user.sessionEpoch;
  }
  if (session.role === "viewer") {
    const viewer = await prisma.viewerUser.findUnique({ where: { id: session.userId } });
    return !!viewer && session.epoch === viewer.sessionEpoch;
  }
  return false;
}

// Re-checks every open connection's session: one revoked after the
// handshake (password change or reset, MFA toggle, viewer reset or
// deletion) gets closed instead of streaming readings until it drops.
// Runs on every heartbeat tick; exported so tests can trigger it.
export async function revalidateClients() {
  for (const ws of wss?.clients ?? []) {
    const client = ws as Client;
    if (!(await isSessionCurrent(client.session))) client.close(4001, "session expired");
  }
}

export function initWs(server: Server, sessionSecret: string) {
  wss = new WebSocketServer({
    server,
    path: "/ws",
    maxPayload: 4096,
    // Async: the signed cookie alone isn't enough anymore — it has to match
    // the account's current sessionEpoch too, same revocation check as
    // requireAnyUser (middleware/auth.ts). That check runs here at the
    // handshake and again on every heartbeat (revalidateClients), so a
    // connection whose session is revoked later is closed too.
    verifyClient: (info, callback) => {
      // Defense in depth, not the actual protection (that's the cookie
      // check below, and sameSite:"strict" already stops the cookie itself
      // from riding along cross-site): reject only when a browser-sent
      // Origin header is present and doesn't match this server's own Host —
      // a cross-site page trying to open a WebSocket here would send a
      // mismatched Origin. Non-browser clients (curl, wscat, a future
      // firmware use) don't send Origin at all and aren't affected.
      const origin = info.origin;
      const host = info.req.headers.host;
      if (origin && host) {
        try {
          if (new URL(origin).host !== host) {
            callback(false, 401, "Unauthorized");
            return;
          }
        } catch {
          callback(false, 401, "Unauthorized");
          return;
        }
      }

      isSessionCurrent(readSession(info.req, sessionSecret))
        .then((ok) => callback(ok, 401, "Unauthorized"))
        .catch(() => callback(false, 500, "Internal error"));
    },
  });

  // Standard ws heartbeat (from the library's own docs): terminate any
  // client that didn't answer the previous ping, so a half-open connection
  // (network dropped without a clean close) doesn't accumulate forever.
  const HEARTBEAT_MS = 30_000;
  wss.on("connection", (ws, req) => {
    const client = ws as Client;
    client.session = readSession(req, sessionSecret);
    client.isAlive = true;
    client.on("pong", () => {
      client.isAlive = true;
    });
  });

  setInterval(() => {
    for (const ws of wss?.clients ?? []) {
      const client = ws as Client;
      if (client.isAlive === false) {
        client.terminate();
        continue;
      }
      client.isAlive = false;
      client.ping();
    }
    revalidateClients().catch((err) => console.error("[ws] session revalidation failed", err));
  }, HEARTBEAT_MS);
}

export function broadcastReading(sensorId: string, reading: unknown) {
  if (!wss) return;
  const payload = JSON.stringify({ type: "reading", sensorId, reading });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  }
}
