import { Router } from "express";
import { z } from "zod";
import { createUser, getUserByEmail, getUserById, toPublicUser } from "../db/usersRepo";
import { hashPassword, verifyPassword } from "../lib/password";
import { signAuthToken, verifyAuthToken } from "../lib/jwt";
import { touchLastLogin } from "../db/usersRepo";

export const authRouter = Router();

const registerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  password: z.string().min(6).max(200),
  phone: z.string().trim().min(3).max(40).optional(),
});

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(200),
});

function getBearerToken(req: any) {
  const header = req.header("authorization") || "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m?.[1] || null;
}

authRouter.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, message: "Invalid input", issues: parsed.error.issues });
  }

  const existing = getUserByEmail(parsed.data.email);
  if (existing) return res.status(409).json({ success: false, message: "Email already registered" });

  const passwordHash = await hashPassword(parsed.data.password);
  const user = createUser({
    email: parsed.data.email,
    passwordHash,
    name: parsed.data.name,
    role: "seller",
    phone: parsed.data.phone ?? null,
  });

  const token = signAuthToken({
    sub: user.id,
    role: user.role,
    email: user.email,
    name: user.name,
  });

  res.status(201).json({ success: true, data: { user: toPublicUser(user), token } });
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, message: "Invalid input", issues: parsed.error.issues });
  }

  const user = getUserByEmail(parsed.data.email);
  if (!user) return res.status(401).json({ success: false, message: "Invalid email or password" });
  if (user.role !== "seller" && user.role !== "admin") {
    return res.status(403).json({ success: false, message: "Unsupported account role" });
  }
  if (user.is_disabled) {
    return res.status(403).json({ success: false, message: "Account disabled" });
  }

  const ok = await verifyPassword(parsed.data.password, user.password_hash);
  if (!ok) return res.status(401).json({ success: false, message: "Invalid email or password" });

  touchLastLogin(user.id);
  const token = signAuthToken({
    sub: user.id,
    role: user.role,
    email: user.email,
    name: user.name,
  });

  res.json({ success: true, data: { user: toPublicUser(user), token } });
});

authRouter.get("/me", (req, res) => {
  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ success: false, message: "Unauthorized" });

  let claims;
  try {
    claims = verifyAuthToken(token);
  } catch {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  const user = getUserById(claims.sub);
  if (!user) return res.status(401).json({ success: false, message: "Unauthorized" });
  if (user.is_disabled) {
    return res.status(403).json({ success: false, message: "Account disabled" });
  }

  res.json({ success: true, data: { user: toPublicUser(user) } });
});

authRouter.post("/logout", (_req, res) => {
  // JWT is stateless; client discards token.
  res.json({ success: true });
});
