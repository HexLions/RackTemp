import { Request, Response, NextFunction } from "express";
import { prisma } from "../db";

// Now async: cookie-session is stateless (the signed cookie is the only
// record of a session, no server-side store), so the only way to revoke an
// outstanding session — a stolen cookie, a device left logged in — after a
// password change/reset or MFA toggle is to compare the session's own
// sessionEpoch snapshot against the current one in the DB on every request,
// and reject on mismatch. See the schema.prisma comment on AdminUser.sessionEpoch.
//
// The explicit session.role !== "admin" check matters beyond just "reject
// viewers here too": AdminUser.id is always 1 (a singleton, see its own
// schema comment), while ViewerUser.id is a normal auto-increment starting
// at 1 as well - without this check, the very first viewer account ever
// created would authenticate as the real admin the instant its session hit
// this function, since session.userId (1) would match adminUser's row by
// coincidence. Every route gated by requireAuth is meant to be admin-only;
// this is what actually makes that true once ViewerUser exists.
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const session = req.session as any;
  if (!session || !session.userId || session.role !== "admin") {
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

// Admin or viewer, either one - only for routes a read-only viewer is
// meant to reach (currently just the read side of sensors.ts). Anything
// gated by requireAuth above stays admin-only; this is the one deliberate
// exception, not a general-purpose relaxation.
export async function requireAnyUser(req: Request, res: Response, next: NextFunction) {
  const session = req.session as any;
  if (!session || !session.userId || !session.role) {
    return res.status(401).json({ error: "not authenticated" });
  }

  if (session.role === "admin") {
    const user = await prisma.adminUser.findUnique({ where: { id: session.userId } });
    if (!user || session.epoch !== user.sessionEpoch) {
      req.session = null;
      return res.status(401).json({ error: "session expired" });
    }
    if (session.mustChangePassword) {
      return res.status(403).json({ error: "must_change_password" });
    }
    return next();
  }

  if (session.role === "viewer") {
    const viewer = await prisma.viewerUser.findUnique({ where: { id: session.userId } });
    if (!viewer || session.epoch !== viewer.sessionEpoch) {
      req.session = null;
      return res.status(401).json({ error: "session expired" });
    }
    return next();
  }

  return res.status(401).json({ error: "not authenticated" });
}
