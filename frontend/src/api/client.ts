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
  staticIp: string | null;
  apiKey: string;
  chipId: string | null;
  keyHandoutUntil: string | null;
  keyHandedOut: boolean;
  firmwareVersion: string | null;
  rebootRequested: boolean;
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
  minHumidity: number | null;
  maxHumidity: number | null;
  maxOfflineMin: number;
  hysteresis: number;
  cooldownMin: number;
  enabled: boolean;
  mutedUntil: string | null;
}

export interface Reading {
  id: string;
  sensorId: string;
  temperature: number;
  humidity: number | null;
  rssi: number | null;
  createdAt: string;
}

export interface NotificationLogEntry {
  id: string;
  sensorId: string;
  sensor: { name: string };
  type: string;
  message: string;
  sentAt: string;
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
  emailProvider: "smtp" | "graph";
  graphTenantId: string | null;
  graphClientId: string | null;
  graphClientSecret: string | null;
  graphSenderEmail: string | null;
  telegramEnabled: boolean;
  telegramToken: string | null;
  telegramChatId: string | null;
}

export interface DiscoveredDevice {
  id: string;
  chipId: string;
  ip: string | null;
  firmware: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface IntegrationSettings {
  prtgToken: string;
  portainerWebhookUrl: string | null;
}

export interface UpdateCheck {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseUrl: string;
  platform: "windows" | "linux" | "docker";
  downloadUrl: string | null;
}

export interface VersionInfo {
  version: string;
  commit: string;
}

export interface FirmwareRelease {
  version: string;
  notes: string | null;
  sha256: string | null;
  uploadedAt: string;
}

export interface BackupSettings {
  enabled: boolean;
  intervalHours: number;
  retentionCount: number;
  emailOnBackup: boolean;
  lastBackupAt: string | null;
}

export interface BackupFileInfo {
  name: string;
  size: number;
  createdAt: string;
}

export interface TlsCertInfo {
  exists: boolean;
  generatedAt: string | null;
  fingerprint: string | null;
}

export interface HttpsSettings {
  httpsEnabled: boolean;
  cert: TlsCertInfo;
}
