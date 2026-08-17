import { Router } from "express";
import { z } from "zod";
import { requireSeller } from "../auth";
import { createSellerProduct, deleteSellerProduct, listSellerProducts, updateSellerProduct } from "../db/productsRepo";
import { getProviderByIdForSeller } from "../db/smmProvidersRepo";
import { bulkUpdateServiceForSeller, bulkUpdateServiceIdByRuleNameForSeller, createRule, deleteRule, getRuleById, listRulesForProduct, updateRule } from "../db/smmRulesRepo";
import { getSellerProductById } from "../db/productsRepo";
import { decryptSecret } from "../lib/encryption";
import { assertHostnameResolvesToPublicIp, assertPublicHttpsUrl } from "../lib/ssrf";
import { listPanelV2Services } from "../smm/panelV2Adapter";

export const sellerProductsRouter = Router();
sellerProductsRouter.use(requireSeller);

const optionalText = (max: number) =>
  z.string().trim().max(max).optional().nullable();

const optionalNumber = z.preprocess(
  (val) => (val === "" || val === null ? null : val),
  z.coerce.number().min(0).optional().nullable(),
);

const productCreateSchema = z.object({
  salla_product_id: z.string().trim().min(1).max(64).optional().nullable(),
  name: z.string().trim().min(1).max(200),
  sku: optionalText(80),
  handler: z.string().trim().max(40).optional(),
  product_type: optionalText(80),
  category: optionalText(80),
  base_price: optionalNumber,
  base_cost: optionalNumber,
  description: optionalText(2000),
  status: z.enum(["active", "inactive"]).optional().default("active"),
});

const productPatchSchema = z.object({
  salla_product_id: z.string().trim().min(1).max(64).optional().nullable(),
  name: z.string().trim().min(1).max(200).optional(),
  sku: optionalText(80),
  handler: z.string().trim().max(40).optional().nullable(),
  product_type: optionalText(80),
  category: optionalText(80),
  base_price: optionalNumber,
  base_cost: optionalNumber,
  description: optionalText(2000),
  status: z.enum(["active", "inactive"]).optional(),
});

function normalizeOptionalString(value: string | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

async function tryFetchProviderServiceSnapshot(input: {
  sellerId: string;
  providerConnectionId: string;
  providerServiceId: number;
}): Promise<
  | { ok: true; rate: number | null; min: number | null; max: number | null }
  | { ok: false; message: string }
> {
  if (process.env.NODE_ENV === "test") {
    return { ok: false, message: "Pricing snapshot skipped in tests" };
  }

  const row = getProviderByIdForSeller(input.sellerId, input.providerConnectionId);
  if (!row) return { ok: false, message: "Invalid provider" };

  let baseUrl: URL;
  try {
    baseUrl = assertPublicHttpsUrl(row.base_url);
    await assertHostnameResolvesToPublicIp(baseUrl.hostname);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Invalid provider URL";
    return { ok: false, message };
  }

  let apiKey: string;
  try {
    apiKey = decryptSecret(row.api_key_encrypted);
  } catch {
    return { ok: false, message: "Stored API key cannot be decrypted" };
  }

  try {
    const result = await listPanelV2Services(baseUrl, apiKey);
    if (!result.ok) return { ok: false, message: result.message };
    const svc = result.services.find((s) => s.id === input.providerServiceId);
    if (!svc) return { ok: false, message: "Service not found in provider services list" };
    return { ok: true, rate: svc.rate ?? null, min: svc.min ?? null, max: svc.max ?? null };
  } catch (e) {
    const message =
      e instanceof Error
        ? e.message.includes("timeout")
          ? "Connection timeout"
          : e.message
        : "Connection failed";
    return { ok: false, message };
  }
}

sellerProductsRouter.get("/", (req, res) => {
  const sellerId = req.sellerAuth!.sellerId;
  const rows = listSellerProducts(sellerId);
  res.json({ success: true, data: rows });
});

sellerProductsRouter.post("/", (req, res) => {
  const sellerId = req.sellerAuth!.sellerId;
  const parsed = productCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Invalid input", issues: parsed.error.issues });

  try {
    const row = createSellerProduct({
      sellerId,
      sallaProductId: parsed.data.salla_product_id ?? null,
      name: parsed.data.name,
      sku: normalizeOptionalString(parsed.data.sku) ?? null,
      handler: normalizeOptionalString(parsed.data.handler) ?? "smm",
      productType: normalizeOptionalString(parsed.data.product_type) ?? null,
      category: normalizeOptionalString(parsed.data.category) ?? null,
      basePrice: parsed.data.base_price ?? null,
      baseCost: parsed.data.base_cost ?? null,
      description: normalizeOptionalString(parsed.data.description) ?? null,
      status: parsed.data.status,
    });
    return res.status(201).json({ success: true, data: row });
  } catch (e: any) {
    const msg = typeof e?.message === "string" && e.message.includes("UNIQUE") ? "Duplicate Salla product id" : "Failed to create";
    return res.status(409).json({ success: false, message: msg });
  }
});

sellerProductsRouter.patch("/:id", (req, res) => {
  const sellerId = req.sellerAuth!.sellerId;
  const parsed = productPatchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Invalid input", issues: parsed.error.issues });

  try {
    const row = updateSellerProduct(sellerId, req.params.id, {
      sallaProductId: parsed.data.salla_product_id,
      name: parsed.data.name,
      sku: normalizeOptionalString(parsed.data.sku),
      handler: normalizeOptionalString(parsed.data.handler) ?? (parsed.data.handler === undefined ? undefined : "smm"),
      productType: normalizeOptionalString(parsed.data.product_type),
      category: normalizeOptionalString(parsed.data.category),
      basePrice: parsed.data.base_price,
      baseCost: parsed.data.base_cost,
      description: normalizeOptionalString(parsed.data.description),
      status: parsed.data.status,
    });
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    return res.json({ success: true, data: row });
  } catch (e: any) {
    const msg = typeof e?.message === "string" && e.message.includes("UNIQUE") ? "Duplicate Salla product id" : "Failed to update";
    return res.status(409).json({ success: false, message: msg });
  }
});

sellerProductsRouter.delete("/:id", (req, res) => {
  const sellerId = req.sellerAuth!.sellerId;
  const ok = deleteSellerProduct(sellerId, req.params.id);
  if (!ok) return res.status(404).json({ success: false, message: "Not found" });
  return res.json({ success: true });
});

const conditionSchema = z.object({
  field: z.string().trim().min(1).max(60),
  op: z.enum(["equals", "contains", "gt", "lt"]),
  value: z.string().trim().min(1).max(200),
});

const ruleCreateSchema = z.object({
  provider_connection_id: z.string().trim().min(1),
  provider_service_id: z.number().int().positive(),
  service_name: z.string().trim().min(1).max(200),
  platform: z.enum(["tiktok", "instagram"]).optional().nullable(),
  target_field: z.enum(["link", "username", "post_link", "video_link", "custom"]).optional().default("link"),
  target_value: z.string().trim().max(500).optional().nullable(),
  quantity_type: z.enum(["fixed", "from_field"]),
  quantity_value: z.number().int().positive().optional().nullable(),
  quantity_field: z.string().trim().min(1).max(60).optional().nullable(),
  delay_seconds: z.number().int().min(0).max(86400).optional().default(0),
  execution_order: z.number().int().min(1).max(50).optional().default(1),
  normalize_url: z.boolean().optional().default(true),
  url_handler: z.string().trim().min(1).max(80).optional().nullable(),
  conditions: z.array(conditionSchema).optional().nullable(),
});

const rulePatchSchema = ruleCreateSchema.partial();

const bulkUpdateServiceSchema = z.object({
  provider_connection_id: z.string().trim().min(1),
  from_provider_service_id: z.number().int().positive(),
  to_provider_service_id: z.number().int().positive(),
  to_service_name: z.string().trim().min(1).max(200),
  mode: z.enum(["all_matching", "products"]),
  product_ids: z.array(z.string().trim().min(1)).optional(),
});

const bulkUpdateServiceByNameSchema = z.object({
  provider_connection_id: z.string().trim().min(1),
  rule_name: z.string().trim().min(1).max(200),
  to_provider_service_id: z.number().int().positive(),
  mode: z.enum(["all_matching", "products"]),
  product_ids: z.array(z.string().trim().min(1)).optional(),
});

sellerProductsRouter.get("/:id/rules", (req, res) => {
  const sellerId = req.sellerAuth!.sellerId;
  const product = getSellerProductById(sellerId, req.params.id);
  if (!product) return res.status(404).json({ success: false, message: "Not found" });
  const rows = listRulesForProduct(sellerId, req.params.id);
  res.json({ success: true, data: rows });
});

sellerProductsRouter.post("/:id/rules", async (req, res) => {
  const sellerId = req.sellerAuth!.sellerId;
  const product = getSellerProductById(sellerId, req.params.id);
  if (!product) return res.status(404).json({ success: false, message: "Not found" });

  const parsed = ruleCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Invalid input", issues: parsed.error.issues });

  const provider = getProviderByIdForSeller(sellerId, parsed.data.provider_connection_id);
  if (!provider) return res.status(400).json({ success: false, message: "Invalid provider" });

  if (parsed.data.quantity_type === "fixed" && !parsed.data.quantity_value) {
    return res.status(400).json({ success: false, message: "quantity_value is required for fixed quantity" });
  }
  if (parsed.data.quantity_type === "from_field" && !parsed.data.quantity_field) {
    return res.status(400).json({ success: false, message: "quantity_field is required for field quantity" });
  }

  const snapshot = await tryFetchProviderServiceSnapshot({
    sellerId,
    providerConnectionId: parsed.data.provider_connection_id,
    providerServiceId: parsed.data.provider_service_id,
  });

  const row = createRule({
    sellerId,
    productId: req.params.id,
    providerConnectionId: parsed.data.provider_connection_id,
    providerServiceId: parsed.data.provider_service_id,
    serviceName: parsed.data.service_name,
    providerServiceRate: snapshot.ok ? snapshot.rate : null,
    providerServiceMin: snapshot.ok ? snapshot.min : null,
    providerServiceMax: snapshot.ok ? snapshot.max : null,
    platform: parsed.data.platform ?? null,
    targetField: parsed.data.target_field ?? "link",
    targetValue: parsed.data.target_value ?? null,
    quantityType: parsed.data.quantity_type,
    quantityValue: parsed.data.quantity_value ?? null,
    quantityField: parsed.data.quantity_field ?? null,
    delaySeconds: parsed.data.delay_seconds,
    executionOrder: parsed.data.execution_order,
    normalizeUrl: parsed.data.normalize_url,
    urlHandler: parsed.data.url_handler ?? null,
    conditions: parsed.data.conditions ?? null,
  });

  res.status(201).json({
    success: true,
    data: row,
    pricing_snapshot: snapshot.ok ? { ok: true } : { ok: false, message: snapshot.message },
  });
});

sellerProductsRouter.patch("/rules/:ruleId", async (req, res) => {
  const sellerId = req.sellerAuth!.sellerId;
  const parsed = rulePatchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Invalid input", issues: parsed.error.issues });

  const existing = getRuleById(sellerId, req.params.ruleId);
  if (!existing) return res.status(404).json({ success: false, message: "Not found" });

  if (parsed.data.provider_connection_id) {
    const provider = getProviderByIdForSeller(sellerId, parsed.data.provider_connection_id);
    if (!provider) return res.status(400).json({ success: false, message: "Invalid provider" });
  }

  const nextQuantityType = parsed.data.quantity_type ?? existing.quantity_type;
  const nextQuantityValue = parsed.data.quantity_value !== undefined ? parsed.data.quantity_value : existing.quantity_value;
  const nextQuantityField = parsed.data.quantity_field !== undefined ? parsed.data.quantity_field : existing.quantity_field;

  if (nextQuantityType === "fixed") {
    if (!nextQuantityValue || nextQuantityValue <= 0) {
      return res.status(400).json({ success: false, message: "quantity_value is required for fixed quantity" });
    }
  } else {
    if (!nextQuantityField || !String(nextQuantityField).trim().length) {
      return res.status(400).json({ success: false, message: "quantity_field is required for field quantity" });
    }
  }

  const nextProviderConnectionId = parsed.data.provider_connection_id ?? existing.provider_connection_id;
  const nextProviderServiceId = parsed.data.provider_service_id ?? existing.provider_service_id;
  const refreshSnapshot = parsed.data.provider_connection_id !== undefined || parsed.data.provider_service_id !== undefined;
  const snapshot = refreshSnapshot
    ? await tryFetchProviderServiceSnapshot({
        sellerId,
        providerConnectionId: nextProviderConnectionId,
        providerServiceId: nextProviderServiceId,
      })
    : null;

  const row = updateRule(sellerId, req.params.ruleId, {
    providerConnectionId: parsed.data.provider_connection_id,
    providerServiceId: parsed.data.provider_service_id,
    serviceName: parsed.data.service_name,
    providerServiceRate: snapshot ? (snapshot.ok ? snapshot.rate : null) : undefined,
    providerServiceMin: snapshot ? (snapshot.ok ? snapshot.min : null) : undefined,
    providerServiceMax: snapshot ? (snapshot.ok ? snapshot.max : null) : undefined,
    platform: parsed.data.platform,
    targetField: parsed.data.target_field,
    targetValue: parsed.data.target_value ?? undefined,
    quantityType: parsed.data.quantity_type,
    quantityValue: parsed.data.quantity_value,
    quantityField: parsed.data.quantity_field,
    delaySeconds: parsed.data.delay_seconds,
    executionOrder: parsed.data.execution_order,
    normalizeUrl: parsed.data.normalize_url,
    urlHandler: parsed.data.url_handler ?? undefined,
    conditions: parsed.data.conditions,
  });
  if (!row) return res.status(404).json({ success: false, message: "Not found" });
  res.json({
    success: true,
    data: row,
    pricing_snapshot: snapshot ? (snapshot.ok ? { ok: true } : { ok: false, message: snapshot.message }) : undefined,
  });
});

sellerProductsRouter.delete("/rules/:ruleId", (req, res) => {
  const sellerId = req.sellerAuth!.sellerId;
  const ok = deleteRule(sellerId, req.params.ruleId);
  if (!ok) return res.status(404).json({ success: false, message: "Not found" });
  res.json({ success: true });
});

sellerProductsRouter.post("/rules/bulk-update-service", async (req, res) => {
  const sellerId = req.sellerAuth!.sellerId;
  const parsed = bulkUpdateServiceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Invalid input", issues: parsed.error.issues });

  if (parsed.data.from_provider_service_id === parsed.data.to_provider_service_id) {
    return res.status(400).json({ success: false, message: "New service id must be different" });
  }

  let productIds: string[] | undefined = undefined;
  if (parsed.data.mode === "products") {
    const ids = parsed.data.product_ids ?? [];
    if (!ids.length) return res.status(400).json({ success: false, message: "product_ids is required for products mode" });

    for (const id of ids) {
      const p = getSellerProductById(sellerId, id);
      if (!p) return res.status(400).json({ success: false, message: "Invalid product id" });
    }

    productIds = ids;
  }

  const snapshot = await tryFetchProviderServiceSnapshot({
    sellerId,
    providerConnectionId: parsed.data.provider_connection_id,
    providerServiceId: parsed.data.to_provider_service_id,
  });

  const out = bulkUpdateServiceForSeller({
    sellerId,
    providerConnectionId: parsed.data.provider_connection_id,
    fromServiceId: parsed.data.from_provider_service_id,
    toServiceId: parsed.data.to_provider_service_id,
    toServiceName: parsed.data.to_service_name,
    toServiceRate: snapshot.ok ? snapshot.rate : null,
    toServiceMin: snapshot.ok ? snapshot.min : null,
    toServiceMax: snapshot.ok ? snapshot.max : null,
    productIds,
  });

  res.json({
    success: true,
    data: out,
    pricing_snapshot: snapshot.ok ? { ok: true } : { ok: false, message: snapshot.message },
  });
});

sellerProductsRouter.post("/rules/bulk-update-service-by-name", async (req, res) => {
  const sellerId = req.sellerAuth!.sellerId;
  const parsed = bulkUpdateServiceByNameSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Invalid input", issues: parsed.error.issues });

  let productIds: string[] | undefined = undefined;
  if (parsed.data.mode === "products") {
    const ids = parsed.data.product_ids ?? [];
    if (!ids.length) return res.status(400).json({ success: false, message: "product_ids is required for products mode" });

    for (const id of ids) {
      const p = getSellerProductById(sellerId, id);
      if (!p) return res.status(400).json({ success: false, message: "Invalid product id" });
    }

    productIds = ids;
  }

  const snapshot = await tryFetchProviderServiceSnapshot({
    sellerId,
    providerConnectionId: parsed.data.provider_connection_id,
    providerServiceId: parsed.data.to_provider_service_id,
  });

  const out = bulkUpdateServiceIdByRuleNameForSeller({
    sellerId,
    providerConnectionId: parsed.data.provider_connection_id,
    ruleName: parsed.data.rule_name,
    toServiceId: parsed.data.to_provider_service_id,
    toServiceRate: snapshot.ok ? snapshot.rate : null,
    toServiceMin: snapshot.ok ? snapshot.min : null,
    toServiceMax: snapshot.ok ? snapshot.max : null,
    productIds,
  });

  res.json({
    success: true,
    data: out,
    pricing_snapshot: snapshot.ok ? { ok: true } : { ok: false, message: snapshot.message },
  });
});
