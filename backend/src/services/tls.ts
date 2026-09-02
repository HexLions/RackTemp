import fs from "fs";
import os from "os";
import path from "path";
import { X509Certificate } from "crypto";
import { generate as generateSelfSigned } from "selfsigned";
import { resolveDbPath } from "./dbPath";

// Same "next to the database" placement as session-secret and backups —
// survives restarts/rebuilds since it lives in the data volume/directory,
// not the image or program folder.
function tlsDir(): string {
  const dbPath = resolveDbPath();
  const dir = dbPath ? path.dirname(dbPath) : path.resolve(__dirname, "../../data");
  return path.join(dir, "tls");
}

function certPath(): string {
  return path.join(tlsDir(), "cert.pem");
}
function keyPath(): string {
  return path.join(tlsDir(), "key.pem");
}

// All the LAN-reachable IPs this machine currently has, plus loopback: a
// self-signed cert with no matching SAN entry for the address you actually
// browse to gets an extra "not valid for this address" warning on top of
// the already-expected "self-signed" one. Regenerate (see below) if the
// machine's IP changes later (DHCP lease, new NIC, ...).
function localSanEntries(): { type: 7; ip: string }[] {
  const ips = new Set(["127.0.0.1", "::1"]);
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (!addr.internal) ips.add(addr.address);
    }
  }
  return [...ips].map((ip) => ({ type: 7 as const, ip }));
}

// LAN-reachable IPv4 addresses this machine currently has, no loopback - the
// admin-facing "what address do I actually use" answer (Settings > Network,
// system.ts's /network-info). Separate from localSanEntries() above: that one
// needs loopback + IPv6 too since anything reachable should also be a valid
// cert SAN, this one only needs plain IPv4 addresses someone would actually
// type into the sensor's setup portal or a monitoring tool's config.
//
// Also excludes 169.254.0.0/16 (APIPA/link-local) - Windows self-assigns one
// of these to any adapter that's up but never got a real DHCP lease (a
// disconnected Wi-Fi card, a virtual adapter for a VPN/Hyper-V/Docker Desktop
// that's installed but idle, ...). It's real to the OS but not reachable from
// anywhere else on the actual LAN, so listing it next to the real address
// alongside it (confirmed: reported by an actual user, exactly this) is
// actively misleading rather than just extra noise.
export function lanIps(): string[] {
  const ips: string[] = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (!addr.internal && addr.family === "IPv4" && !addr.address.startsWith("169.254.")) {
        ips.push(addr.address);
      }
    }
  }
  return ips;
}

interface TlsCertInfo {
  key: string;
  cert: string;
  fingerprint: string;
  generatedAt: string;
}

async function generateAndSave(): Promise<TlsCertInfo> {
  const notBefore = new Date();
  const notAfter = new Date(notBefore);
  // ~2.25 years — the longest lifetime modern browsers still treat as sane
  // for a public CA cert; no such limit applies to a self-signed one, but
  // there's no reason to pick a longer default.
  notAfter.setDate(notAfter.getDate() + 825);

  const pems = await generateSelfSigned([{ name: "commonName", value: "racktemp.local" }], {
    algorithm: "sha256",
    notBeforeDate: notBefore,
    notAfterDate: notAfter,
    keySize: 2048,
    extensions: [
      { name: "basicConstraints", cA: false },
      { name: "keyUsage", digitalSignature: true, keyEncipherment: true, critical: true },
      { name: "extKeyUsage", serverAuth: true },
      {
        name: "subjectAltName",
        altNames: [{ type: 2, value: "localhost" }, ...localSanEntries()],
      },
    ],
  });

  const dir = tlsDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(keyPath(), pems.private, { mode: 0o600 });
  fs.writeFileSync(certPath(), pems.cert, { mode: 0o600 });

  return { key: pems.private, cert: pems.cert, fingerprint: pems.fingerprint, generatedAt: new Date().toISOString() };
}

// Loads the saved self-signed cert, generating one on first use. Called at
// startup only when HTTPS is enabled (see index.ts) — no cert is ever
// generated for an install that never turns the toggle on.
export async function resolveTlsCert(): Promise<TlsCertInfo> {
  const kPath = keyPath();
  const cPath = certPath();
  if (fs.existsSync(kPath) && fs.existsSync(cPath)) {
    const key = fs.readFileSync(kPath, "utf8");
    const cert = fs.readFileSync(cPath, "utf8");
    const stat = fs.statSync(cPath);
    return { key, cert, fingerprint: certFingerprint(cert), generatedAt: stat.mtime.toISOString() };
  }
  return generateAndSave();
}

// Forces a fresh cert (new key pair too) — e.g. the machine's IP changed
// since the last one was generated, or it's simply expired.
export async function regenerateTlsCert(): Promise<TlsCertInfo> {
  return generateAndSave();
}

function certFingerprint(certPem: string): string {
  return new X509Certificate(certPem).fingerprint256;
}

// Cheap existence/metadata check for the Settings UI — doesn't need to read
// key material just to show "cert generated on <date>".
export function tlsCertInfo(): { exists: boolean; generatedAt: string | null; fingerprint: string | null } {
  const cPath = certPath();
  if (!fs.existsSync(cPath)) return { exists: false, generatedAt: null, fingerprint: null };
  const stat = fs.statSync(cPath);
  const cert = fs.readFileSync(cPath, "utf8");
  return { exists: true, generatedAt: stat.mtime.toISOString(), fingerprint: certFingerprint(cert) };
}
