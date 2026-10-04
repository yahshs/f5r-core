import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sellerSmmProvidersRouter } from "./routes/sellerSmmProviders";
import { ensureDbReady } from "./db/db";
import { authRouter } from "./routes/authRoutes";
import { sellerProductsRouter } from "./routes/sellerProducts";
import { sellerSallaRouter } from "./routes/sellerSalla";
import { sellerOrdersRouter } from "./routes/sellerOrders";
import { adminOrdersRouter } from "./routes/adminOrders";
import { adminUsersRouter } from "./routes/adminUsers";
import { adminProvidersRouter } from "./routes/adminProviders";
import { adminProductsRouter } from "./routes/adminProducts";
import { adminSallaConnectionsRouter } from "./routes/adminSallaConnections";
import { adminAuditLogsRouter } from "./routes/adminAuditLogs";
import { adminSettingsRouter } from "./routes/adminSettings";
import { adminCategoriesRouter } from "./routes/adminCategories";
import { adminSummaryRouter } from "./routes/adminSummary";
import { sellerAnalyticsRouter } from "./routes/sellerAnalytics";
import { adminAnalyticsRouter } from "./routes/adminAnalytics";
import { handleSallaWebhook } from "./routes/webhooksSalla";
import { startWorkers,workerHealth } from "./workers/startWorkers";
import { sellerSubscriptionRouter } from "./routes/sellerSubscription";
import { adminSubscriptionRequestsRouter } from "./routes/adminSubscriptionRequests";
import { sellerNotificationsRouter } from "./routes/sellerNotifications";
import { handleTelegramWebhook } from "./routes/webhooksTelegram";
import { sallaAppRouter } from "./routes/sallaApp";
import { sellerCompensationBotRouter } from "./routes/sellerCompensationBot";
import { rateLimit } from "express-rate-limit";
import crypto from "node:crypto";
import fs from "node:fs";
import { operationalMetrics } from "./lib/operationalMetrics";
import { validateRuntimeConfig } from "./lib/runtimeConfig";
import { getDb } from "./db/db";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function createApp(options: { distDir?: string } = {}) {
  validateRuntimeConfig();
  await ensureDbReady();

  const app = express();
  app.disable("x-powered-by");
  const proxyHops = Number(process.env.TRUST_PROXY_HOPS || 0);
  if (!Number.isInteger(proxyHops) || proxyHops < 0 || proxyHops > 5) throw new Error("Invalid TRUST_PROXY_HOPS");
  app.set("trust proxy", proxyHops);
  app.use((req, res, next) => {
    // Cookie requests use SameSite plus same-origin validation for unsafe methods.
    if (!['GET','HEAD','OPTIONS'].includes(req.method) && req.headers.cookie?.includes('f5r_session=') && req.headers.origin && req.headers.origin !== process.env.BASE_PUBLIC_URL?.replace(/\/+$/, "")) return res.status(403).json({ success: false, message: "Invalid request origin" });
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Referrer-Policy", "same-origin");
    res.set("X-Frame-Options", "DENY");
    res.locals.cspNonce = crypto.randomBytes(24).toString("base64");
    res.set("Content-Security-Policy", `default-src 'self'; script-src 'self' 'nonce-${res.locals.cspNonce}'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' https: data:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`);
    if (process.env.NODE_ENV === "production") res.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    res.locals.requestId = crypto.randomUUID();
    res.set("X-Request-ID", res.locals.requestId);
    next();
  });
  app.use("/api", rateLimit({ windowMs: 60000, limit: 300, standardHeaders: "draft-8", legacyHeaders: false }));
  app.use("/api/auth", rateLimit({ windowMs: 15*60000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false }));

  // Public webhooks must read raw body (do not use express.json here).
  app.post("/api/webhooks/salla/:publicId", express.raw({ type: "*/*", limit: "256kb" }), handleSallaWebhook);
  app.post("/api/webhooks/telegram", express.json({ limit: "256kb" }), handleTelegramWebhook);

  app.use(express.json({ limit: "256kb" }));
  app.use(express.urlencoded({ extended: false, limit: "256kb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });
  app.get("/api/metrics", (req, res) => {
    const expected = process.env.MONITORING_TOKEN;
    if (!expected || Buffer.byteLength(expected) < 32) return res.sendStatus(503);
    const given = Buffer.from(req.headers.authorization ?? "");
    const secret = Buffer.from(`Bearer ${expected}`);
    if (given.length !== secret.length || !crypto.timingSafeEqual(given, secret)) return res.sendStatus(401);
    res.set("Cache-Control", "no-store");
    res.type("text/plain; version=0.0.4").send(operationalMetrics());
  });
  app.get("/api/ready", (_req, res) => {
    try {
      getDb().prepare("SELECT 1").get();
      if(getDb().pragma('foreign_keys',{simple:true})!==1)throw new Error('Integrity enforcement unavailable');
      if(process.env.NODE_ENV!=='test'&&!workerHealth().healthy)throw new Error('Workers unavailable');
      res.json({ok:true});
    } catch {res.status(503).json({ok:false});}
  });

  app.use("/api/integrations/salla", sallaAppRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/seller/smm-providers", sellerSmmProvidersRouter);
  app.use("/api/seller/products", sellerProductsRouter);
  app.use("/api/seller/salla", sellerSallaRouter);
  app.use("/api/seller/orders", sellerOrdersRouter);
  app.use("/api/seller/subscription", sellerSubscriptionRouter);
  app.use("/api/seller/notifications", sellerNotificationsRouter);
  app.use("/api/seller/compensation-bot", sellerCompensationBotRouter);
  app.use("/api/seller/analytics", sellerAnalyticsRouter);
  app.use("/api/admin/orders", adminOrdersRouter);
  app.use("/api/admin/users", adminUsersRouter);
  app.use("/api/admin/providers", adminProvidersRouter);
  app.use("/api/admin/products", adminProductsRouter);
  app.use("/api/admin/salla-connections", adminSallaConnectionsRouter);
  app.use("/api/admin/audit-logs", adminAuditLogsRouter);
  app.use("/api/admin/settings", adminSettingsRouter);
  app.use("/api/admin/categories", adminCategoriesRouter);
  app.use("/api/admin/summary", adminSummaryRouter);
  app.use("/api/admin/analytics", adminAnalyticsRouter);
  app.use("/api/admin/subscription-requests", adminSubscriptionRequestsRouter);

  // Production: serve Vite build from the same Express server.
  if (process.env.NODE_ENV === "production") {
    const distDir = options.distDir ?? path.resolve(__dirname, "..", "dist");
    const serveIndex: express.RequestHandler = (_req, res, next) => {
      fs.readFile(path.join(distDir, "index.html"), "utf8", (error, html) => {
        if (error) return next(error);
        res.set("Cache-Control", "no-store");
        res.type("html").send(html.replace("</head>", `<meta name="csp-nonce" content="${res.locals.cspNonce}"></head>`));
      });
    };
    app.get(["/", "/index.html"], serveIndex);
    app.use(express.static(distDir));
    app.get(/^\/(?!api(?:\/|$)).*/, serveIndex);
  }

  if (process.env.NODE_ENV !== "test" && process.env.WORKERS_ENABLED !== "0") {
    startWorkers();
  }

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = typeof err === "object" && err && "status" in err && (err.status === 413 || err.status === 400) ? err.status : 500;
    console.error("[request] failed", { requestId: res.locals.requestId, status });
    res.status(status).json({ success: false, message: status === 413 ? "Request too large" : status === 400 ? "Invalid request" : "Unexpected error", requestId: res.locals.requestId });
  });

  return app;
}
