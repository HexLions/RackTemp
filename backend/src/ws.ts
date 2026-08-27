import { WebSocketServer, WebSocket } from "ws";
import type { Server, IncomingMessage } from "http";
import { parse as parseCookies } from "cookie";
import Keygrip from "keygrip";

let wss: WebSocketServer | null = null;

interface SessionPayload {
  userId?: number;
  mustChangePassword?: boolean;
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
    verifyClient: (info, callback) => {
      const session = readSession(info.req, sessionSecret);
      if (!session?.userId || session.mustChangePassword) {
        callback(false, 401, "Unauthorized");
        return;
      }
      callback(true);
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
