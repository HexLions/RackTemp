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
