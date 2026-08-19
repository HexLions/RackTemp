import { Request, Response, NextFunction } from "express";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const session = req.session as any;
  if (!session || !session.userId) {
    return res.status(401).json({ error: "not authenticated" });
  }
  next();
}
