import { Router } from "express";
import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";
import multer from "multer";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import { prisma } from "../db";
import { resolveDbPath } from "../services/dbPath";

export const authRouter = Router();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid body" });

  const { username, password } = parsed.data;
  const user = await prisma.adminUser.findUnique({ where: { username } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: "invalid credentials" });
  }

  (req.session as any).userId = user.id;
  (req.session as any).mustChangePassword = user.mustChangePassword;
  res.json({ ok: true, username: user.username, mustChangePassword: user.mustChangePassword });
});

authRouter.post("/logout", (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

authRouter.get("/me", async (req, res) => {
  const session = req.session as any;
  if (!session?.userId) return res.status(401).json({ error: "not authenticated" });
  const user = await prisma.adminUser.findUnique({ where: { id: session.userId } });
  if (!user) return res.status(401).json({ error: "not authenticated" });
  res.json({ username: user.username, mustChangePassword: user.mustChangePassword });
});

// Usato solo al primo accesso (credenziali di default admin/admin): l'utente
// sceglie username e password definitivi prima di poter usare il resto dell'app.
const firstLoginSchema = z.object({
  newUsername: z.string().min(3),
  newPassword: z.string().min(8),
});

authRouter.post("/first-login", async (req, res) => {
  const session = req.session as any;
  if (!session?.userId) return res.status(401).json({ error: "not authenticated" });

  const user = await prisma.adminUser.findUnique({ where: { id: session.userId } });
  if (!user) return res.status(401).json({ error: "not authenticated" });
  if (!user.mustChangePassword) return res.status(400).json({ error: "already configured" });

  const parsed = firstLoginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid body" });

  const existing = await prisma.adminUser.findUnique({ where: { username: parsed.data.newUsername } });
  if (existing && existing.id !== user.id) {
    return res.status(400).json({ error: "username già in uso" });
  }

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
  const updated = await prisma.adminUser.update({
    where: { id: user.id },
    data: { username: parsed.data.newUsername, passwordHash, mustChangePassword: false },
  });

  session.mustChangePassword = false;
  res.json({ ok: true, username: updated.username, mustChangePassword: false });
});

// Solo al primissimo accesso (mustChangePassword ancora true, prima che
// l'utente scelga credenziali vere): permette di sostituire il database
// appena creato con un backup .sqlite caricato, invece di configurare tutto
// da zero. Gate doppio — sessione autenticata + mustChangePassword ancora
// true — così non è mai invocabile su un'istanza già configurata.
const RESTORE_TMP_DIR = path.join(__dirname, "../../data/restore-tmp");
fs.mkdirSync(RESTORE_TMP_DIR, { recursive: true });
const restoreUpload = multer({
  storage: multer.diskStorage({
    destination: RESTORE_TMP_DIR,
    filename: (_req, _file, cb) => cb(null, `upload-${Date.now()}.sqlite`),
  }),
  limits: { fileSize: 200 * 1024 * 1024 },
});

authRouter.post("/restore-backup", restoreUpload.single("backup"), async (req, res) => {
  const cleanup = () => {
    if (req.file) fs.unlink(req.file.path, () => {});
  };

  const session = req.session as any;
  if (!session?.userId) {
    cleanup();
    return res.status(401).json({ error: "not authenticated" });
  }

  const user = await prisma.adminUser.findUnique({ where: { id: session.userId } });
  if (!user || !user.mustChangePassword) {
    cleanup();
    return res.status(403).json({ error: "ripristino disponibile solo al primo accesso" });
  }

  if (!req.file) return res.status(400).json({ error: "file di backup mancante" });

  // Verifica che sia davvero un database RackTemp prima di sovrascrivere
  // quello attuale — apre il file caricato con un client separato invece
  // di fidarsi solo dell'estensione.
  const testClient = new PrismaClient({ datasources: { db: { url: `file:${req.file.path}` } } });
  try {
    await testClient.adminUser.findFirst();
  } catch {
    await testClient.$disconnect();
    cleanup();
    return res.status(400).json({ error: "file non valido: non è un backup RackTemp riconoscibile" });
  }
  await testClient.$disconnect();

  const dbPath = resolveDbPath();
  if (!dbPath) {
    cleanup();
    return res.status(500).json({ error: "percorso database non configurato" });
  }

  await prisma.$disconnect();
  fs.copyFileSync(req.file.path, dbPath);
  cleanup();

  res.json({ ok: true, restarting: true });
  // Il processo deve riavviarsi per riconnettersi puliti al db sostituito —
  // Docker/nssm/systemd lo fanno ripartire da soli (restart:unless-stopped /
  // default nssm / Restart=on-failure, tutti coprono l'exit code 1).
  setTimeout(() => process.exit(1), 500);
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

authRouter.post("/change-password", async (req, res) => {
  const session = req.session as any;
  if (!session?.userId) return res.status(401).json({ error: "not authenticated" });
  if (session.mustChangePassword) return res.status(403).json({ error: "must_change_password" });

  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid body" });

  const user = await prisma.adminUser.findUnique({ where: { id: session.userId } });
  if (!user || !(await bcrypt.compare(parsed.data.currentPassword, user.passwordHash))) {
    return res.status(401).json({ error: "invalid current password" });
  }

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
  await prisma.adminUser.update({ where: { id: user.id }, data: { passwordHash } });
  res.json({ ok: true });
});
