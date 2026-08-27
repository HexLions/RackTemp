import fs from "fs";
import path from "path";
import { resolveDataDir } from "./dbPath";

// Same trust boundary as the console/log line the token is also printed
// to (docker compose logs / journalctl / service.log) — reading this file
// still requires access to the server's filesystem, not just its network
// port. Just easier to find: `cat` a fixed path instead of scrolling or
// grepping through logs. Also what the Windows tray app watches to show a
// balloon notification with the token — see windows-tray/RackTempTray.
function tokenFilePath(): string {
  return path.join(resolveDataDir(), "SETUP-TOKEN.txt");
}

export function writeSetupTokenFile(token: string) {
  const filePath = tokenFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, token + "\n", { mode: 0o600 });
}

// Called once setup no longer needs a token — first-login succeeded, or
// (on a restart) the current database already belongs to a fully
// configured admin, e.g. after /restore-backup replaced it with one.
export function clearSetupTokenFile() {
  const filePath = tokenFilePath();
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}
