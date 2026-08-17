import bcrypt from "bcryptjs";

export async function hashPassword(password: string) {
  if (password.length < 6) throw new Error("Password too short");
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, passwordHash: string) {
  return bcrypt.compare(password, passwordHash);
}

