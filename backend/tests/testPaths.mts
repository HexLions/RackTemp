import os from "os";
import path from "path";

// Shared by vitest.config.mts and globalSetup.ts, which both run in the main
// vitest process (same pid). Test workers get the same values through
// test.env in vitest.config.ts.
export const TEST_DATA_DIR = path.join(os.tmpdir(), `racktemp-test-${process.pid}`);
export const TEST_DATABASE_URL = `file:${path.join(TEST_DATA_DIR, "test.sqlite")}`;
