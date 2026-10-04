export function validateRuntimeConfig() {
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.DEMO_PASSWORD) throw new Error("Demo accounts are prohibited in production");
  if (!process.env.JWT_SECRET || Buffer.byteLength(process.env.JWT_SECRET) < 32) throw new Error("Production JWT_SECRET must be at least 32 bytes");
  if (!process.env.ENCRYPTION_KEY) throw new Error("Production ENCRYPTION_KEY is required");
  const key = process.env.ENCRYPTION_KEY.trim();
  const bytes = /^[a-f\d]{64}$/i.test(key) ? Buffer.from(key,"hex") : Buffer.from(key,"base64");
  if (bytes.length !== 32) throw new Error("Production ENCRYPTION_KEY must encode 32 bytes");
  const base = new URL(process.env.BASE_PUBLIC_URL || "");
  if (base.protocol !== "https:" || base.username || base.password) throw new Error("Production BASE_PUBLIC_URL must be HTTPS");
  if (process.env.SALLA_CLIENT_ID && (process.env.SALLA_STATE_SECRET?.length || 0) < 32) throw new Error("Production SALLA_STATE_SECRET must be at least 32 characters");
}
