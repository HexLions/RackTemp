import { defineConfig } from "vitest/config";
import { TEST_DATA_DIR, TEST_DATABASE_URL } from "./tests/testPaths.mts";

// Every test run gets its own throwaway data dir: the SQLite database, the
// field-encryption key, restore-tmp/ and backups/ all resolve next to
// DATABASE_URL (see src/services/dbPath.ts), so nothing touches a real
// install's data/ directory.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/globalSetup.ts"],
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      RACKTEMP_TEST_DATA_DIR: TEST_DATA_DIR,
    },
    // One shared SQLite file: run test files one after another.
    fileParallelism: false,
  },
});
