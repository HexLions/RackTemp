import path from "path";

// DATABASE_URL is a "file:" path resolved by Prisma relative to
// backend/prisma/ (not the process cwd) — see backend/prisma/schema.prisma.
// Mirror that same resolution here so anything that needs the raw .sqlite
// file (backup, restore, scheduled backups) always points at the real
// database regardless of how DATABASE_URL is written (relative for Docker,
// absolute for the Windows/Linux native installs).
export function resolveDbPath(): string | null {
  const url = process.env.DATABASE_URL;
  if (!url || !url.startsWith("file:")) return null;
  const relative = url.slice("file:".length);
  return path.resolve(__dirname, "../../prisma", relative);
}

// The directory the database actually lives in — same "next to db.sqlite"
// placement already used for the session secret. On Docker this coincides
// with a hardcoded "../../data" (DATABASE_URL is "file:../data/db.sqlite"
// there), which is why services that never took DATABASE_URL into account
// happened to work anyway; on the native Windows/Linux installs it doesn't
// (DB in /var/lib/racktemp/data, program files elsewhere), so anything
// using the hardcoded path was writing into the wrong directory there.
export function resolveDataDir(): string {
  const dbPath = resolveDbPath();
  return dbPath ? path.dirname(dbPath) : path.resolve(__dirname, "../../data");
}
