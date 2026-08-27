import { Request, Response, NextFunction } from "express";
import { prisma } from "../db";

// Now async: cookie-session is stateless (the signed cookie is the only
// record of a session, no server-side store), so the only way to revoke an
// outstanding session — a stolen cookie, a device left logged in — after a
// password change/reset or MFA toggle is to compare the session's own
// sessionEpoch snapshot against the current one in the DB on every request,
// and reject on mismatch. See the schema.prisma comment on AdminUser.sessionEpoch.
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const session = req.session as any;
  if (!session || !session.userId) {
    return res.status(401).json({ error: "not authenticated" });
  }

  const user = await prisma.adminUser.findUnique({ where: { id: session.userId } });
  if (!user || session.epoch !== user.sessionEpoch) {
    req.session = null;
    return res.status(401).json({ error: "session expired" });
  }

  if (session.mustChangePassword) {
    return res.status(403).json({ error: "must_change_password" });
  }
  next();
}
