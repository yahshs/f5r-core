import type { Request, Response, NextFunction } from "express";
import { resolveSession } from "./db/authSessionsRepo";

export type SellerAuth = {
  sellerId: string;
};

declare module "express-serve-static-core" {
  interface Request {
    sellerAuth?: SellerAuth;
    authUser?: { id: string; role: string; email: string; name: string };
    authSessionId?: string;
  }
}

function getBearerToken(req: Request) {
  const header = req.header("authorization") || "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (m?.[1] && m[1] !== "cookie") return m[1];
  return String(req.headers.cookie || "").split(";").map(s=>s.trim()).find(s=>s.startsWith("f5r_session="))?.slice(12) || null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ success: false, message: "Unauthorized" });

  try {
    const { user, sessionId } = resolveSession(token);
    req.authUser = { id: user.id, role: user.role, email: user.email, name: user.name };
    req.authSessionId = sessionId;
    return next();
  } catch {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
}

export function requireSeller(req: Request, res: Response, next: NextFunction) {
  requireAuth(req, res, () => {
    const role = (req.authUser?.role || "").toLowerCase();
    if (role !== "seller") return res.status(403).json({ success: false, message: "Forbidden" });
    req.sellerAuth = { sellerId: req.authUser!.id };
    next();
  });
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  requireAuth(req, res, () => {
    const role = (req.authUser?.role || "").toLowerCase();
    if (role !== "admin") return res.status(403).json({ success: false, message: "Forbidden" });
    next();
  });
}
