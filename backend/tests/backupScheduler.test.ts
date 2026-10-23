import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/db";
import { startBackupScheduler } from "../src/services/backupScheduler";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("backup scheduler", () => {
  it("logs a failing settings read instead of leaving an unhandled rejection", async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(prisma.backupSettings, "upsert").mockRejectedValue(new Error("database is locked"));
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);

    startBackupScheduler();
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);

    expect(error).toHaveBeenCalledWith("[backup] scheduled backup failed", expect.any(Error));
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
    vi.clearAllTimers();
  });
});
