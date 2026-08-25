import type { Request, Response, NextFunction } from "express";
import { verifyAuthToken } from "./lib/jwt";

export type SellerAuth = {
  sellerId: string;
};

declare module "express-serve-static-core" {
  interface Request {
    sellerAuth?: SellerAuth;
    authUser?: { id: string; role: string; email: string; name: string };
  }
}

function getBearerToken(req: Request) {
  const header = req.header("authorization") || "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m?.[1] || null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ success: false, message: "Unauthorized" });

  try {
    const claims = verifyAuthToken(token);
    req.authUser = { id: claims.sub, role: claims.role, email: claims.email, name: claims.name };
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
