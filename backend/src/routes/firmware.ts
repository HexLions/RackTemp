import { Router } from "express";
import { ah } from "../middleware/asyncHandler";
import multer from "multer";
import fs from "fs";
import path from "path";
import { prisma } from "../db";
import { requireAuth } from "../middleware/auth";

export const firmwareRouter = Router();

const FIRMWARE_DIR = path.join(__dirname, "../../data/firmware");
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
firmwareRouter.get("/latest", ah(async (_req, res) => {
  const release = await prisma.firmwareRelease.findUnique({ where: { id: 1 } });
  if (!release || !fs.existsSync(BIN_PATH)) {
    return res.status(404).json({ error: "no firmware uploaded yet" });
  }
  res.json({ version: release.version, notes: release.notes, uploadedAt: release.uploadedAt });
}));

firmwareRouter.get("/latest.bin", (_req, res) => {
  if (!fs.existsSync(BIN_PATH)) return res.status(404).end();
  res.setHeader("Content-Type", "application/octet-stream");
  res.sendFile(BIN_PATH);
});

firmwareRouter.post("/", requireAuth, upload.single("firmware"), ah(async (req, res) => {
  const version = (req.body.version || "").trim();
  const notes = (req.body.notes || "").trim() || null;
  if (!version || !req.file) {
    return res.status(400).json({ error: "version and .bin file are required" });
  }
  const release = await prisma.firmwareRelease.upsert({
    where: { id: 1 },
    update: { version, notes, uploadedAt: new Date() },
    create: { id: 1, version, notes },
  });
  res.json(release);
}));
