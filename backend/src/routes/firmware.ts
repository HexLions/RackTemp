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

// An upload interrupted mid-request never reaches this route's own
// cleanup() and leaves an orphaned upload-*.bin behind — same pattern as
// RESTORE_TMP_DIR in routes/auth.ts. Sweep once at startup.
for (const f of fs.readdirSync(FIRMWARE_DIR)) {
  if (f.startsWith("upload-") && f.endsWith(".bin")) fs.unlinkSync(path.join(FIRMWARE_DIR, f));
}

const upload = multer({
  storage: multer.diskStorage({
    destination: FIRMWARE_DIR,
    // Temp name, not "latest.bin" directly: multer writes this before the
    // route handler even runs, so writing straight to latest.bin meant a
    // request with a missing/invalid version overwrote the last good binary
    // with an unvalidated one before the 400 was ever returned — sensors
    // would then OTA to a build with no matching FirmwareRelease.sha256 (or
    // fail the checksum entirely), and the previous good .bin would already
    // be gone. Renamed into place only after validation passes, below.
    filename: (_req, _file, cb) => cb(null, `upload-${Date.now()}.bin`),
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
  const cleanup = () => {
    if (req.file) fs.unlink(req.file.path, () => {});
  };

  const version = (req.body?.version ?? "").trim();
  const notes = (req.body?.notes ?? "").trim() || null;
  if (!version || !req.file) {
    cleanup();
    return res.status(400).json({ error: "version and .bin file are required" });
  }

  const sha256 = createHash("sha256").update(fs.readFileSync(req.file.path)).digest("hex");
  // Only now, with a validated version and a computed hash in hand, replace
  // the binary sensors are actually served — rename is atomic on the same
  // filesystem (temp file and BIN_PATH are both in FIRMWARE_DIR), so
  // /latest.bin never serves a half-written file either.
  fs.renameSync(req.file.path, BIN_PATH);

  const release = await prisma.firmwareRelease.upsert({
    where: { id: 1 },
    update: { version, notes, sha256, uploadedAt: new Date() },
    create: { id: 1, version, notes, sha256 },
  });
  res.json(release);
}));
