import { Router, type Request } from "express";
import { verifySallaAuthState } from "../lib/sallaAuthState";
import { connectSallaAppInstallation, getSallaConnectionBySellerId, updateSallaConnectionStatus } from "../db/sallaConnectionsRepo";
import { exchangeSallaCodeForTokens, fetchSallaStoreIdentity, registerSallaInvoiceCreatedWebhook } from "../lib/sallaClient";

export const sallaAppRouter = Router();

function getPublicBaseUrl() {
  const env = process.env.BASE_PUBLIC_URL?.trim();
  if (env) return env.replace(/\/+$/, "");
  throw new Error("BASE_PUBLIC_URL is required");
}


function getSallaWebhookPublicUrl(req: Request, publicId: string) {
  const wordpressBase = process.env.WORDPRESS_PUBLIC_URL?.trim().replace(/\/+$/, "");
  if (wordpressBase) {
    return new URL(`/wp-json/f5r/v1/salla/${publicId}`, wordpressBase).toString();
  }
  return new URL(`/api/webhooks/salla/${publicId}`, getPublicBaseUrl()).toString();
}

function redirectToSellerSalla(req: Request, result: "success" | "error", message?: string) {
  const url = new URL("/seller/salla", getPublicBaseUrl());
  url.searchParams.set("salla_connect", result);
  if (message) url.searchParams.set("message", message);
  return url.toString();
}

sallaAppRouter.get("/callback", async (req, res) => {
  const code = String(req.query.code || "").trim();
  const state = String(req.query.state || "").trim();
  const browserToken = String(req.headers.cookie || "").split(";").map(s=>s.trim()).find(s=>s.startsWith("salla_oauth="))?.slice(12) || "";
  let authorizedSellerId: string | null = null;
  res.clearCookie("salla_oauth", { path: "/api/integrations/salla" });
  const explicitError = String(req.query.error || "").trim();

  if (explicitError) {
    return res.redirect(redirectToSellerSalla(req, "error", explicitError));
  }

  try {
    if (!code) throw new Error("Missing authorization code");
    const { sellerId } = verifySallaAuthState(state, browserToken);
    authorizedSellerId = sellerId;

    const existing = getSallaConnectionBySellerId(sellerId);
    if (existing) updateSallaConnectionStatus(existing.id, "pending");

    const tokenSet = await exchangeSallaCodeForTokens(code);
    const store = await fetchSallaStoreIdentity(tokenSet.accessToken);

    const row = connectSallaAppInstallation({
      sellerId,
      storeId: store.storeId,
      storeName: store.storeName,
      storeUrl: store.storeUrl,
      merchantId: store.merchantId,
      accessToken: tokenSet.accessToken,
      refreshToken: tokenSet.refreshToken,
      tokenExpiresAt: tokenSet.expiresAt,
    });

    const webhookUrl = getSallaWebhookPublicUrl(req, row.public_webhook_id!);
    await registerSallaInvoiceCreatedWebhook({
      accessToken: tokenSet.accessToken,
      webhookUrl,
    });

    updateSallaConnectionStatus(row.id, "active");
    return res.redirect(redirectToSellerSalla(req, "success"));
  } catch (error) {
    const message = "Salla connection failed. Please reconnect.";
    if (authorizedSellerId) {
      const row = getSallaConnectionBySellerId(authorizedSellerId);
      if (row) updateSallaConnectionStatus(row.id, "error");
    }
    return res.redirect(redirectToSellerSalla(req, "error", message));
  }
});
