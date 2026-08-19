const BASE = "/api";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error ?? res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: "POST", body: data !== undefined ? JSON.stringify(data) : undefined }),
  put: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: "PUT", body: data !== undefined ? JSON.stringify(data) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

export interface Sensor {
  id: string;
  name: string;
  location: string | null;
  apiKey: string;
  lastSeenAt: string | null;
  createdAt: string;
  threshold: Threshold | null;
  readings?: Reading[];
}

export interface Threshold {
  id: string;
  sensorId: string;
  minTemp: number | null;
  maxTemp: number | null;
  maxOfflineMin: number;
  hysteresis: number;
  cooldownMin: number;
  enabled: boolean;
}

export interface Reading {
  id: string;
  sensorId: string;
  temperature: number;
  humidity: number | null;
  rssi: number | null;
  createdAt: string;
}

export interface NotificationConfig {
  smtpEnabled: boolean;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecure: boolean;
  smtpUser: string | null;
  smtpPass: string | null;
  smtpFrom: string | null;
  smtpTo: string | null;
  telegramEnabled: boolean;
  telegramToken: string | null;
  telegramChatId: string | null;
}
