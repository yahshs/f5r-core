import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sellerSmmProvidersRouter } from "./routes/sellerSmmProviders";
import { ensureDbReady } from "./db/db";
import { authRouter } from "./routes/auth";
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
import { startWorkers } from "./workers/startWorkers";
import { sellerSubscriptionRouter } from "./routes/sellerSubscription";
import { adminSubscriptionRequestsRouter } from "./routes/adminSubscriptionRequests";
import { sellerNotificationsRouter } from "./routes/sellerNotifications";
import { handleTelegramWebhook } from "./routes/webhooksTelegram";
import { sallaAppRouter } from "./routes/sallaApp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function createApp() {
  await ensureDbReady();

  const app = express();
  app.disable("x-powered-by");

  // Public webhooks must read raw body (do not use express.json here).
  app.post("/api/webhooks/salla/:publicId", express.raw({ type: "*/*", limit: "256kb" }), handleSallaWebhook);
  app.post("/api/webhooks/telegram", express.json({ limit: "256kb" }), handleTelegramWebhook);

  app.use(express.json({ limit: "256kb" }));
  app.use(express.urlencoded({ extended: false, limit: "256kb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/api/integrations/salla", sallaAppRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/seller/smm-providers", sellerSmmProvidersRouter);
  app.use("/api/seller/products", sellerProductsRouter);
  app.use("/api/seller/salla", sellerSallaRouter);
  app.use("/api/seller/orders", sellerOrdersRouter);
  app.use("/api/seller/subscription", sellerSubscriptionRouter);
  app.use("/api/seller/notifications", sellerNotificationsRouter);
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
    const distDir = path.resolve(__dirname, "..", "dist");
    app.use(express.static(distDir));
    app.get(/^\/(?!api(?:\/|$)).*/, (_req, res) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
  }

  if (process.env.NODE_ENV !== "test" && process.env.WORKERS_ENABLED !== "0") {
    startWorkers();
  }

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = err instanceof Error ? err.message : "Unexpected error";
    res.status(500).json({ success: false, message });
  });

  return app;
}
