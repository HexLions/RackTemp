import type { NextFunction, Request, RequestHandler, Response } from "express";

// Express 4 doesn't catch rejections thrown by an async handler — an
// unhandled one becomes an unhandled promise rejection, which crashes the
// whole process (Node terminates on unhandled rejection since v15). A
// single bad request (e.g. deleting an id that doesn't exist, which Prisma
// throws P2025 for) was enough to kill the server. Wrap every async route
// handler with this so rejections reach Express's error-handling chain
// instead — see the error handler in index.ts for what happens next.
export function ah(fn: RequestHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
