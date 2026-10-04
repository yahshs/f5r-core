import bcrypt from "bcryptjs";
import { z } from "zod";

export const passwordSchema = z.string().min(10).max(72).refine(value => Buffer.byteLength(value, "utf8") <= 72, "Password must be at most 72 UTF-8 bytes");

export async function hashPassword(password: string) {
  passwordSchema.parse(password);
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, passwordHash: string) {
  return bcrypt.compare(password, passwordHash);
}

