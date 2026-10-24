import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { TEST_DATA_DIR, TEST_DATABASE_URL } from "./testPaths.mts";

// Creates the throwaway SQLite schema once per run (prisma db push, the
// same schema.prisma the app uses) and removes the data dir afterwards.
export default function setup() {
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });

  execFileSync(
    process.execPath,
    [path.resolve(__dirname, "../node_modules/prisma/build/index.js"), "db", "push"],
    {
      cwd: path.resolve(__dirname, ".."),
      env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
      stdio: "pipe",
    },
  );

  return () => fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
}
