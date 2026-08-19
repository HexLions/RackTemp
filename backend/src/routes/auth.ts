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
  res.json({ ok: true, username: user.username });
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
  res.json({ username: user.username });
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

authRouter.post("/change-password", async (req, res) => {
  const session = req.session as any;
  if (!session?.userId) return res.status(401).json({ error: "not authenticated" });

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
