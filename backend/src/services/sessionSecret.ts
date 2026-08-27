import fs from "fs";
import path from "path";
import { randomBytes } from "crypto";
import { resolveDataDir } from "./dbPath";

const MIN_LENGTH = 32;

// Persisted next to the database (resolveDataDir — same resolution as
// resolveDbPath, so this lands in the actual data volume/directory for
// every deploy target — the Docker volume, %ProgramData%\RackTemp\data on
// Windows, /var/lib/racktemp/data on Linux — not a hardcoded backend/data
// that would only be correct for local dev and get wiped on a Windows
// reinstall or Linux upgrade.
function secretFilePath(): string {
  return path.join(resolveDataDir(), "session-secret");
}

export function resolveSessionSecret(): string {
  const fromEnv = process.env.SESSION_SECRET;
  if (fromEnv && fromEnv.length >= MIN_LENGTH && !fromEnv.startsWith("change-me")) {
    return fromEnv;
  }

  const filePath = secretFilePath();
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, "utf8").trim();
  }

  const generated = randomBytes(32).toString("hex");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, generated, { mode: 0o600 });
  console.warn(
    `[session] SESSION_SECRET not set (or too weak) — generated one and saved it to ${filePath}. ` +
      "Set SESSION_SECRET explicitly for multi-instance deploys, or if you'd rather manage it yourself."
  );
  return generated;
}
