import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { decryptField, encryptField } from "../src/services/fieldEncryption";

const keyFile = path.join(process.env.RACKTEMP_TEST_DATA_DIR!, "field-encryption-key");

describe("field encryption", () => {
  it("round-trips a value, including an empty string", () => {
    expect(decryptField(encryptField("smtp-p@ss"))).toBe("smtp-p@ss");
    expect(decryptField(encryptField(""))).toBe("");
  });

  it("never stores the plaintext and uses a fresh IV each time", () => {
    const a = encryptField("same value");
    const b = encryptField("same value");
    expect(a.startsWith("enc:v1:")).toBe(true);
    expect(a).not.toContain("same value");
    expect(a).not.toBe(b);
  });

  it("writes the generated key next to the database, owner-only", () => {
    encryptField("x");
    expect(fs.existsSync(keyFile)).toBe(true);
    if (process.platform !== "win32") {
      expect(fs.statSync(keyFile).mode & 0o777).toBe(0o600);
    }
  });

  it("passes legacy plaintext and null through unchanged", () => {
    expect(decryptField("legacy-plaintext")).toBe("legacy-plaintext");
    expect(decryptField(null)).toBeNull();
    expect(decryptField(undefined)).toBeNull();
  });

  it("rejects a tampered ciphertext (GCM auth tag)", () => {
    const [iv, tag, ct] = encryptField("telegram-token").slice("enc:v1:".length).split(":");
    const bytes = Buffer.from(ct, "base64");
    bytes[0] ^= 0xff;
    const tampered = `enc:v1:${iv}:${tag}:${bytes.toString("base64")}`;
    expect(() => decryptField(tampered)).toThrow();
  });
});
