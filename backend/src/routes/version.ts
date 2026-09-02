import { Router } from "express";
import pkg from "../../package.json";

export const versionRouter = Router();

// No auth: harmless build metadata, and useful to check from a browser even
// before logging in when you're trying to confirm which image is actually
// deployed.
versionRouter.get("/", (_req, res) => {
  res.json({
    version: pkg.version,
    commit: process.env.GIT_SHA || "dev",
  });
});
