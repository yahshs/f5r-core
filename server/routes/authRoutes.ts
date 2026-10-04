import { Router, type Response } from "express";
import { z } from "zod";
import {
  createUser,
  getUserByEmail,
  getUserById,
  toPublicUser,
  touchLastLogin,
} from "../db/usersRepo";
import { hashPassword, verifyPassword } from "../lib/password";
import { issueSessionToken, revokeSession } from "../db/authSessionsRepo";
import { requireAuth } from "../auth";
import { passwordSchema } from "../lib/password";
import { rateLimit } from "express-rate-limit";
import { sha256Hex } from "../lib/hash";
import { asRecord } from "../lib/unknownValue";

export const authRouter = Router();
authRouter.use(
  "/login",
  rateLimit({
    windowMs: 15 * 60000,
    limit: 10,
    skipSuccessfulRequests: true,
    standardHeaders: false,
    legacyHeaders: false,
    keyGenerator: (req) =>
      sha256Hex(
        String(asRecord(req.body).email ?? "")
          .trim()
          .toLowerCase(),
      ),
    handler: (_req, res) =>
      res
        .status(429)
        .json({
          success: false,
          message: "Too many login attempts. Try again later.",
        }),
  }),
);
function setSessionCookie(res: Response, token: string) {
  res.cookie("f5r_session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api",
    maxAge: 3600000,
  });
  res.set("Cache-Control", "no-store");
}

const registerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
  password: passwordSchema,
  phone: z.string().trim().min(3).max(40).optional(),
});

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(200),
});

authRouter.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({
        success: false,
        message: "Invalid input",
        issues: parsed.error.issues,
      });
  }

  const existing = getUserByEmail(parsed.data.email);
  if (existing)
    return res
      .status(409)
      .json({ success: false, message: "Email already registered" });

  const passwordHash = await hashPassword(parsed.data.password);
  if (getUserByEmail(parsed.data.email))
    return res
      .status(409)
      .json({ success: false, message: "Email already registered" });
  const user = createUser({
    email: parsed.data.email,
    passwordHash,
    name: parsed.data.name,
    role: "seller",
    phone: parsed.data.phone ?? null,
  });

  const token = issueSessionToken(user.id);
  setSessionCookie(res, token);

  res
    .status(201)
    .json({ success: true, data: { user: toPublicUser(user), token } });
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({
        success: false,
        message: "Invalid input",
        issues: parsed.error.issues,
      });
  }

  const user = getUserByEmail(parsed.data.email);
  if (!user)
    return res
      .status(401)
      .json({ success: false, message: "Invalid email or password" });
  if (user.role !== "seller" && user.role !== "admin") {
    return res
      .status(403)
      .json({ success: false, message: "Unsupported account role" });
  }
  const ok = await verifyPassword(parsed.data.password, user.password_hash);
  if (!ok)
    return res
      .status(401)
      .json({ success: false, message: "Invalid email or password" });
  if (user.is_disabled)
    return res
      .status(403)
      .json({ success: false, message: "Account disabled" });

  touchLastLogin(user.id);
  const token = issueSessionToken(user.id);
  setSessionCookie(res, token);

  res.json({ success: true, data: { user: toPublicUser(user), token } });
});

authRouter.get("/me", requireAuth, (req, res) => {
  res.json({
    success: true,
    data: { user: toPublicUser(getUserById(req.authUser!.id)!) },
  });
});

authRouter.post("/logout", requireAuth, (req, res) => {
  revokeSession(req.authSessionId!);
  res.clearCookie("f5r_session", { path: "/api" });
  res.json({ success: true });
});

authRouter.post("/change-password", requireAuth, async (req, res) => {
  const parsed = z
    .object({
      currentPassword: z.string().min(1).max(200),
      password: passwordSchema,
    })
    .safeParse(req.body);
  if (!parsed.success)
    return res
      .status(400)
      .json({ success: false, message: "Invalid password" });
  const user = getUserById(req.authUser!.id)!;
  if (!(await verifyPassword(parsed.data.currentPassword, user.password_hash)))
    return res
      .status(401)
      .json({ success: false, message: "Invalid current password" });
  const { updateUserPassword } = await import("../db/usersRepo");
  updateUserPassword(user.id, await hashPassword(parsed.data.password));
  const token = issueSessionToken(user.id);
  setSessionCookie(res, token);
  res.json({ success: true, data: { token, user: toPublicUser(user) } });
});
