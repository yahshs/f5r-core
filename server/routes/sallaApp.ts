import { Router } from "express";
import { verifySallaAuthState } from "../lib/sallaAuthState";
import { connectSallaAppInstallation, getSallaConnectionBySellerId, updateSallaConnectionStatus } from "../db/sallaConnectionsRepo";
import { exchangeSallaCodeForTokens, fetchSallaStoreIdentity, registerSallaInvoiceCreatedWebhook } from "../lib/sallaClient";

export const sallaAppRouter = Router();

function getPublicBaseUrl(req: any) {
  const env = process.env.BASE_PUBLIC_URL?.trim();
  if (env) return env.replace(/\/+$/, "");
  const proto = (req.header("x-forwarded-proto") || req.protocol || "https").split(",")[0].trim();
  const host = (req.header("x-forwarded-host") || req.get("host") || "").split(",")[0].trim();
  return `${proto}://${host}`;
}


function getSallaWebhookPublicUrl(req: any, publicId: string) {
  const wordpressBase = process.env.WORDPRESS_PUBLIC_URL?.trim().replace(/\/+$/, "");
  if (wordpressBase) {
    return new URL(`/wp-json/f5r/v1/salla/${publicId}`, wordpressBase).toString();
  }
  return new URL(`/api/webhooks/salla/${publicId}`, getPublicBaseUrl(req)).toString();
}

function redirectToSellerSalla(req: any, result: "success" | "error", message?: string) {
  const url = new URL("/seller/salla", getPublicBaseUrl(req));
  url.searchParams.set("salla_connect", result);
  if (message) url.searchParams.set("message", message);
  return url.toString();
}

sallaAppRouter.get("/callback", async (req, res) => {
  const code = String(req.query.code || "").trim();
  const state = String(req.query.state || "").trim();
  const explicitError = String(req.query.error || "").trim();

  if (explicitError) {
    return res.redirect(redirectToSellerSalla(req, "error", explicitError));
  }

  try {
    if (!code) throw new Error("Missing authorization code");
    const { sellerId } = verifySallaAuthState(state);

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
    const message = error instanceof Error ? error.message : "Salla connection failed";
    const statePayload = (() => {
      try {
        return verifySallaAuthState(state);
      } catch {
        return null;
      }
    })();
    if (statePayload?.sellerId) {
      const row = getSallaConnectionBySellerId(statePayload.sellerId);
      if (row) updateSallaConnectionStatus(row.id, "error");
    }
    return res.redirect(redirectToSellerSalla(req, "error", message));
  }
});
