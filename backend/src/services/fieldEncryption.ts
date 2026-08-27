import fs from "fs";
import path from "path";
import { randomBytes, createCipheriv, createDecipheriv } from "crypto";
import { resolveDataDir } from "./dbPath";

// Encrypts a handful of DB columns that are genuine credentials to a
// third party (SMTP password, Telegram bot token, Graph client secret,
// TOTP secret) — the ones where a leaked/dumped database directly hands
// an attacker something that works against another system, not just
// against this app. Deliberately NOT applied to Sensor.apiKey or
// IntegrationSettings.prtgToken: those are checked on every single
// ingest/PRTG-poll request (a hot path) and are already treated as
// bearer tokens shown back to the admin in the UI for copying, same
// threat model as any other API key — encrypting them would add a
// decrypt on every request for no real reduction in blast radius (a
// leaked DB already means game over for those either way, since the app
// itself would need to decrypt and compare them constantly).
//
// A separate key from SESSION_SECRET on purpose: leaking one shouldn't
// automatically leak the other (cookie-signing key vs field-encryption
// key are different trust boundaries).

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12; // 96-bit nonce, the GCM-recommended size
const PREFIX = "enc:v1:";

let cachedKey: Buffer | null = null;

function keyFilePath(): string {
  return path.join(resolveDataDir(), "field-encryption-key");
}

function loadOrGenerateKey(): Buffer {
  if (cachedKey) return cachedKey;

  const filePath = keyFilePath();
  if (fs.existsSync(filePath)) {
    cachedKey = Buffer.from(fs.readFileSync(filePath, "utf8").trim(), "hex");
    return cachedKey;
  }

  const generated = randomBytes(KEY_BYTES);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, generated.toString("hex"), { mode: 0o600 });
  console.warn(`[secrets] generated a new field-encryption key and saved it to ${filePath} — back this up along with the database; losing it makes stored SMTP/Telegram/Graph/TOTP secrets unrecoverable.`);
  cachedKey = generated;
  return cachedKey;
}

// Encrypts a value for storage. Always produces the PREFIX-tagged format,
// even for an empty string, so decryptField can tell "encrypted" from
// "legacy plaintext, not migrated yet" unambiguously.
export function encryptField(plain: string): string {
  const key = loadOrGenerateKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return PREFIX + [iv, authTag, ciphertext].map((b) => b.toString("base64")).join(":");
}

// Decrypts a value read from storage. A value without the PREFIX is
// treated as legacy plaintext (from before this feature existed, or from
// a version that hasn't re-saved it yet) and returned unchanged — every
// write path re-encrypts on save, so existing installs self-heal the
// first time each secret is next saved, no separate migration script needed.
export function decryptField(stored: string | null | undefined): string | null {
  if (stored == null) return null;
  if (!stored.startsWith(PREFIX)) return stored;

  const key = loadOrGenerateKey();
  const [ivB64, authTagB64, ciphertextB64] = stored.slice(PREFIX.length).split(":");
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const ciphertext = Buffer.from(ciphertextB64, "base64");

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plain.toString("utf8");
}
