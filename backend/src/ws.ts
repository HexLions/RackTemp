import { WebSocketServer, WebSocket } from "ws";
import type { Server, IncomingMessage } from "http";
import { parse as parseCookies } from "cookie";
import Keygrip from "keygrip";
import { prisma } from "./db";

let wss: WebSocketServer | null = null;

interface SessionPayload {
  userId?: number;
  mustChangePassword?: boolean;
  epoch?: number;
}

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

export function initWs(server: Server, sessionSecret: string) {
  wss = new WebSocketServer({
    server,
    path: "/ws",
    maxPayload: 4096,
    // Async: the signed cookie alone isn't enough anymore — it has to match
    // the account's current sessionEpoch too, same revocation check as
    // requireAuth (middleware/auth.ts), otherwise a cookie revoked by a
    // password change/reset or MFA toggle would keep receiving live
    // readings over this connection even after every REST endpoint rejects it.
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

      const session = readSession(info.req, sessionSecret);
      if (!session?.userId || session.mustChangePassword) {
        callback(false, 401, "Unauthorized");
        return;
      }
      prisma.adminUser
        .findUnique({ where: { id: session.userId } })
        .then((user) => callback(!!user && session.epoch === user.sessionEpoch, 401, "Unauthorized"))
        .catch(() => callback(false, 500, "Internal error"));
    },
  });

  // Standard ws heartbeat (from the library's own docs): terminate any
  // client that didn't answer the previous ping, so a half-open connection
  // (network dropped without a clean close) doesn't accumulate forever.
  const HEARTBEAT_MS = 30_000;
  wss.on("connection", (ws) => {
    const client = ws as WebSocket & { isAlive?: boolean };
    client.isAlive = true;
    client.on("pong", () => {
      client.isAlive = true;
    });
  });

  setInterval(() => {
    for (const ws of wss?.clients ?? []) {
      const client = ws as WebSocket & { isAlive?: boolean };
      if (client.isAlive === false) {
        client.terminate();
        continue;
      }
      client.isAlive = false;
      client.ping();
    }
  }, HEARTBEAT_MS);
}

export function broadcastReading(sensorId: string, reading: unknown) {
  if (!wss) return;
  const payload = JSON.stringify({ type: "reading", sensorId, reading });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  }
}
