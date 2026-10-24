import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "./generated/prisma/client";
import { resolveDbPath } from "./services/dbPath";

// Prisma 7 talks to SQLite through better-sqlite3, which resolves a relative
// path against the process cwd. resolveDbPath() keeps the old meaning
// (relative to backend/prisma/), so existing installs open the same file.
// "unixepoch-ms" is how Prisma 5 stored DateTime columns; the adapter's
// default (ISO 8601 text) would misread every date already in the database.
export function createPrismaClient(dbPath: string): PrismaClient {
  const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` }, { timestampFormat: "unixepoch-ms" });
  return new PrismaClient({ adapter });
}

const dbPath = resolveDbPath();
if (!dbPath) throw new Error('DATABASE_URL must be set to a "file:" SQLite path');

export const prisma = createPrismaClient(dbPath);
