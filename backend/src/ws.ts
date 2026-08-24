import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";

let wss: WebSocketServer | null = null;

export function initWs(server: Server) {
  wss = new WebSocketServer({ server, path: "/ws" });
}

export function broadcastReading(sensorId: string, reading: unknown) {
  if (!wss) return;
  const payload = JSON.stringify({ type: "reading", sensorId, reading });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  }
}
