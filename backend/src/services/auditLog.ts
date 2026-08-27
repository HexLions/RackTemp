import { prisma } from "../db";

// Fire-and-forget from the caller's point of view: a logging failure should
// never break the actual request it's describing. Caught and logged to
// stderr instead of thrown.
export async function logAudit(action: string, opts?: { detail?: string; ip?: string | null }) {
  try {
    await prisma.auditLog.create({
      data: { action, detail: opts?.detail, ip: opts?.ip ?? undefined },
    });
  } catch (err) {
    console.error("[audit] failed to write log entry", err);
  }
}
