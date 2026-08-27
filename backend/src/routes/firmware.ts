import { Router } from "express";
import { ah } from "../middleware/asyncHandler";
import multer from "multer";
import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { prisma } from "../db";
import { requireAuth } from "../middleware/auth";
import { resolveDataDir } from "../services/dbPath";

export const firmwareRouter = Router();

// resolveDataDir(), not a hardcoded "../../data": correct on the native
// Windows/Linux installs too, where the actual data dir isn't next to the
// program files (see services/dbPath.ts).
const FIRMWARE_DIR = path.join(resolveDataDir(), "firmware");
fs.mkdirSync(FIRMWARE_DIR, { recursive: true });
const BIN_PATH = path.join(FIRMWARE_DIR, "latest.bin");

const upload = multer({
  storage: multer.diskStorage({
    destination: FIRMWARE_DIR,
    filename: (_req, _file, cb) => cb(null, "latest.bin"),
  }),
  limits: { fileSize: 8 * 1024 * 1024 }, // plenty for an ESP32/ESP8266 sketch
});

// Public, no auth: devices poll this to decide whether to self-update.
// Includes the uploaded .bin's SHA256 so the firmware can verify it wasn't
// corrupted or swapped in transit (HTTPUpdate.setSHA256sum) before flashing —
// see the OTA_AUTO_UPDATE comment in the .ino for what this does and doesn't cover.
firmwareRouter.get("/latest", ah(async (_req, res) => {
  const release = await prisma.firmwareRelease.findUnique({ where: { id: 1 } });
  if (!release || !fs.existsSync(BIN_PATH)) {
    return res.status(404).json({ error: "no firmware uploaded yet" });
  }
  res.json({ version: release.version, notes: release.notes, sha256: release.sha256, uploadedAt: release.uploadedAt });
}));

firmwareRouter.get("/latest.bin", (_req, res) => {
  if (!fs.existsSync(BIN_PATH)) return res.status(404).end();
  res.setHeader("Content-Type", "application/octet-stream");
  res.sendFile(BIN_PATH);
});

firmwareRouter.post("/", ah(requireAuth), upload.single("firmware"), ah(async (req, res) => {
  const version = (req.body?.version ?? "").trim();
  const notes = (req.body?.notes ?? "").trim() || null;
  if (!version || !req.file) {
    return res.status(400).json({ error: "version and .bin file are required" });
  }
  const sha256 = createHash("sha256").update(fs.readFileSync(BIN_PATH)).digest("hex");
  const release = await prisma.firmwareRelease.upsert({
    where: { id: 1 },
    update: { version, notes, sha256, uploadedAt: new Date() },
    create: { id: 1, version, notes, sha256 },
  });
  res.json(release);
}));
