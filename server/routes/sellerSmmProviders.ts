import { Router } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import { requireSeller } from "../auth";
import { assertHostnameResolvesToPublicIp, assertPublicHttpsUrl } from "../lib/ssrf";
import { decryptSecret, encryptSecret } from "../lib/encryption";
import { last4 } from "../lib/mask";
import {
  createProvider,
  deleteProvider,
  getDefaultActiveProviderForSeller,
  getProviderByIdForSeller,
  listProvidersForSeller,
  updateLastTest,
  updateProvider,
} from "../db/smmProvidersRepo";
import { testPanelV2Connection, listPanelV2Services } from "../smm/panelV2Adapter";

export const sellerSmmProvidersRouter = Router();

sellerSmmProvidersRouter.use(requireSeller);

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  base_url: z.string().trim().min(1).max(2048),
  api_key: z.string().min(1).max(1024),
  cost_currency: z.string().trim().min(1).max(24).optional().nullable(),
  fx_rate_to_store: z.coerce.number().gt(0).max(1000).optional().nullable(),
  low_balance_threshold: z.coerce.number().gte(0).max(1_000_000).optional().nullable(),
  is_active: z.boolean().optional().default(true),
  is_default: z.boolean().optional().default(false),
});

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  base_url: z.string().trim().min(1).max(2048).optional(),
  api_key: z.string().min(1).max(1024).optional(),
  cost_currency: z.string().trim().min(1).max(24).optional().nullable(),
  fx_rate_to_store: z.coerce.number().gt(0).max(1000).optional().nullable(),
  low_balance_threshold: z.coerce.number().gte(0).max(1_000_000).optional().nullable(),
  is_active: z.boolean().optional(),
  is_default: z.boolean().optional(),
});

sellerSmmProvidersRouter.get("/", (req, res) => {
  const sellerId = req.sellerAuth!.sellerId;
  const rows = listProvidersForSeller(sellerId);
  res.json({
    success: true,
    data: rows.map((r) => ({
      id: r.id,
      name: r.name,
      base_url: r.base_url,
      api_key_last4: r.api_key_last4,
      cost_currency: r.cost_currency ?? null,
      fx_rate_to_store: r.fx_rate_to_store ?? null,
      low_balance_threshold: r.low_balance_threshold ?? null,
      is_active: !!r.is_active,
      is_default: !!r.is_default,
      last_tested_at: r.last_tested_at,
      last_test_status: r.last_test_status,
      last_test_message: r.last_test_message,
      created_at: r.created_at,
      updated_at: r.updated_at,
    })),
  });
});

sellerSmmProvidersRouter.post("/", async (req, res) => {
  const sellerId = req.sellerAuth!.sellerId;
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, message: "Invalid input", issues: parsed.error.issues });
  }

  const url = assertPublicHttpsUrl(parsed.data.base_url);
  try {
    await assertHostnameResolvesToPublicIp(url.hostname);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Hostname validation failed";
    return res.status(400).json({ success: false, message });
  }
  const encrypted = encryptSecret(parsed.data.api_key);
  const id = crypto.randomUUID();

  const row = createProvider({
    id,
    sellerId,
    name: parsed.data.name,
    baseUrl: url.toString(),
    apiKeyEncrypted: encrypted,
    apiKeyLast4: last4(parsed.data.api_key),
    costCurrency: parsed.data.cost_currency ?? null,
    fxRateToStore: parsed.data.fx_rate_to_store ?? null,
    lowBalanceThreshold: parsed.data.low_balance_threshold ?? null,
    isActive: parsed.data.is_active,
    isDefault: parsed.data.is_default,
  });

  res.status(201).json({
    success: true,
    data: {
      id: row!.id,
      name: row!.name,
      base_url: row!.base_url,
      api_key_last4: row!.api_key_last4,
      cost_currency: row!.cost_currency ?? null,
      fx_rate_to_store: row!.fx_rate_to_store ?? null,
      low_balance_threshold: row!.low_balance_threshold ?? null,
      is_active: !!row!.is_active,
      is_default: !!row!.is_default,
      last_tested_at: row!.last_tested_at,
      last_test_status: row!.last_test_status,
      last_test_message: row!.last_test_message,
      created_at: row!.created_at,
      updated_at: row!.updated_at,
    },
  });
});

sellerSmmProvidersRouter.patch("/:id", async (req, res) => {
  const sellerId = req.sellerAuth!.sellerId;
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, message: "Invalid input", issues: parsed.error.issues });
  }

  const id = req.params.id;

  const next: any = {};
  if (parsed.data.name !== undefined) next.name = parsed.data.name;
  if (parsed.data.base_url !== undefined) {
    const url = assertPublicHttpsUrl(parsed.data.base_url);
    try {
      await assertHostnameResolvesToPublicIp(url.hostname);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Hostname validation failed";
      return res.status(400).json({ success: false, message });
    }
    next.baseUrl = url.toString();
  }
  if (parsed.data.is_active !== undefined) next.isActive = parsed.data.is_active;
  if (parsed.data.is_default !== undefined) next.isDefault = parsed.data.is_default;
  if (parsed.data.api_key !== undefined) {
    next.apiKeyEncrypted = encryptSecret(parsed.data.api_key);
    next.apiKeyLast4 = last4(parsed.data.api_key);
  }
  if (parsed.data.cost_currency !== undefined) next.costCurrency = parsed.data.cost_currency;
  if (parsed.data.fx_rate_to_store !== undefined) next.fxRateToStore = parsed.data.fx_rate_to_store;
  if (parsed.data.low_balance_threshold !== undefined) next.lowBalanceThreshold = parsed.data.low_balance_threshold;

  const row = updateProvider(sellerId, id, next);
  if (!row) return res.status(404).json({ success: false, message: "Not found" });

  res.json({
    success: true,
    data: {
      id: row.id,
      name: row.name,
      base_url: row.base_url,
      api_key_last4: row.api_key_last4,
      cost_currency: row.cost_currency ?? null,
      fx_rate_to_store: row.fx_rate_to_store ?? null,
      low_balance_threshold: row.low_balance_threshold ?? null,
      is_active: !!row.is_active,
      is_default: !!row.is_default,
      last_tested_at: row.last_tested_at,
      last_test_status: row.last_test_status,
      last_test_message: row.last_test_message,
      created_at: row.created_at,
      updated_at: row.updated_at,
    },
  });
});

sellerSmmProvidersRouter.delete("/:id", (req, res) => {
  const sellerId = req.sellerAuth!.sellerId;
  const ok = deleteProvider(sellerId, req.params.id);
  if (!ok) return res.status(404).json({ success: false, message: "Not found" });
  res.json({ success: true });
});

sellerSmmProvidersRouter.post("/:id/test", async (req, res) => {
  const sellerId = req.sellerAuth!.sellerId;
  const row = getProviderByIdForSeller(sellerId, req.params.id);
  if (!row) return res.status(404).json({ success: false, message: "Not found" });

  let baseUrl: URL;
  try {
    baseUrl = assertPublicHttpsUrl(row.base_url);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Invalid URL";
    updateLastTest(sellerId, row.id, { status: "FAIL", message });
    return res.status(400).json({ success: false, message });
  }

  let apiKey: string;
  try {
    apiKey = decryptSecret(row.api_key_encrypted);
  } catch {
    updateLastTest(sellerId, row.id, { status: "FAIL", message: "Stored API key cannot be decrypted" });
    return res.status(500).json({ success: false, message: "Stored API key cannot be decrypted" });
  }

  try {
    const result = await testPanelV2Connection(baseUrl, apiKey);
    const updated = updateLastTest(sellerId, row.id, {
      status: result.ok ? "SUCCESS" : "FAIL",
      message: result.message,
    });
    return res.json({
      success: result.ok,
      message: result.message,
      data: {
        id: updated!.id,
        last_tested_at: updated!.last_tested_at,
        last_test_status: updated!.last_test_status,
        last_test_message: updated!.last_test_message,
      },
    });
  } catch (e) {
    const message =
      e instanceof Error
        ? e.message.includes("timeout")
          ? "Connection timeout"
          : e.message
        : "Connection failed";
    const updated = updateLastTest(sellerId, row.id, { status: "FAIL", message });
    return res.status(502).json({
      success: false,
      message,
      data: {
        id: updated!.id,
        last_tested_at: updated!.last_tested_at,
        last_test_status: updated!.last_test_status,
        last_test_message: updated!.last_test_message,
      },
    });
  }
});

sellerSmmProvidersRouter.get("/default/active", (req, res) => {
  const sellerId = req.sellerAuth!.sellerId;
  const row = getDefaultActiveProviderForSeller(sellerId);
  if (!row) return res.status(404).json({ success: false, message: "Not found" });
  res.json({
    success: true,
    data: {
      id: row.id,
      name: row.name,
      base_url: row.base_url,
      api_key_last4: row.api_key_last4,
      cost_currency: row.cost_currency ?? null,
      fx_rate_to_store: row.fx_rate_to_store ?? null,
      low_balance_threshold: row.low_balance_threshold ?? null,
      is_active: !!row.is_active,
      is_default: !!row.is_default,
      last_tested_at: row.last_tested_at,
      last_test_status: row.last_test_status,
      last_test_message: row.last_test_message,
      created_at: row.created_at,
      updated_at: row.updated_at,
    },
  });
});

sellerSmmProvidersRouter.get("/:id/services", async (req, res) => {
  const sellerId = req.sellerAuth!.sellerId;
  const row = getProviderByIdForSeller(sellerId, req.params.id);
  if (!row) return res.status(404).json({ success: false, message: "Not found" });

  let baseUrl: URL;
  try {
    baseUrl = assertPublicHttpsUrl(row.base_url);
    await assertHostnameResolvesToPublicIp(baseUrl.hostname);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Invalid provider URL";
    return res.status(400).json({ success: false, message });
  }

  let apiKey: string;
  try {
    apiKey = decryptSecret(row.api_key_encrypted);
  } catch {
    return res.status(500).json({ success: false, message: "Stored API key cannot be decrypted" });
  }

  try {
    const result = await listPanelV2Services(baseUrl, apiKey);
    if (!result.ok) return res.status(502).json({ success: false, message: result.message });
    return res.json({ success: true, data: result.services });
  } catch (e) {
    const message =
      e instanceof Error
        ? e.message.includes("timeout")
          ? "Connection timeout"
          : e.message
        : "Connection failed";
    return res.status(502).json({ success: false, message });
  }
});
