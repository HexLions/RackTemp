import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../db";

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
