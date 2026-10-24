import "dotenv/config";
import path from "path";
import { defineConfig } from "prisma/config";

// Prisma 7 no longer reads the URL from schema.prisma. A relative "file:"
// DATABASE_URL has always meant relative to backend/prisma/ (Docker uses
// "file:../data/db.sqlite"), so it is resolved the same way here and in
// src/services/dbPath.ts, otherwise `db push` would create a second, empty
// database somewhere else. Left unset when DATABASE_URL is missing, which
// `prisma generate` doesn't need (the Docker build runs it without one).
function databaseUrl(): string | undefined {
  const url = process.env.DATABASE_URL;
  if (!url?.startsWith("file:")) return url;
  return `file:${path.resolve(__dirname, "prisma", url.slice("file:".length))}`;
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: { url: databaseUrl() },
});
