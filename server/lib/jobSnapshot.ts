import { z } from "zod";
import type { SmmProductRuleRow } from "../db/smmRulesRepo";
import type { SmmProviderRow } from "../db/smmProvidersRepo";

const ruleSchema = z.object({
  id: z.string(),
  seller_id: z.string(),
  product_id: z.string(),
  provider_connection_id: z.string(),
  provider_service_id: z.number().int().positive(),
  service_name: z.string(),
  provider_service_rate: z.number().finite().nonnegative().nullable(),
  provider_service_min: z.number().int().nonnegative().nullable(),
  provider_service_max: z.number().int().positive().nullable(),
  target_field: z.enum([
    "link",
    "username",
    "post_link",
    "video_link",
    "custom",
  ]),
  platform: z.enum(["tiktok", "instagram", "twitter"]).nullable(),
  target_value: z.string().nullable(),
  quantity_type: z.enum(["fixed", "from_field"]),
  quantity_value: z.number().finite().positive().nullable(),
  quantity_field: z.string().nullable(),
  delay_seconds: z.number().int().nonnegative(),
  execution_order: z.number().int().positive(),
  normalize_url: z.union([z.literal(0), z.literal(1)]),
  url_handler: z.string().nullable(),
  conditions_json: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
const snapshotSchema = z.object({
  version: z.literal(1),
  capturedAt: z.string(),
  rule: ruleSchema,
  input: z
    .object({
      targetJson: z
        .string()
        .max(2 * 1024 * 1024)
        .nullable(),
      quantity: z.number().int().positive(),
    })
    .optional(),
  provider: z.object({
    id: z.string(),
    baseUrl: z.string().url(),
    currency: z.string().nullable(),
    fx: z.number().finite().positive().nullable(),
  }),
});
export function captureJobSnapshot(
  rule: SmmProductRuleRow,
  provider: SmmProviderRow,
  input?: { targetJson: string | null; quantity: number },
) {
  return JSON.stringify(
    snapshotSchema.parse({
      version: 1,
      capturedAt: new Date().toISOString(),
      rule,
      input,
      provider: {
        id: provider.id,
        baseUrl: provider.base_url,
        currency: provider.cost_currency,
        fx: provider.fx_rate_to_store,
      },
    }),
  );
}
export function readJobSnapshot(text: string) {
  return snapshotSchema.parse(JSON.parse(text));
}
export function currencyMinorUnits(amount: number, currency: string) {
  if (!/^[A-Z]{3}$/.test(currency.toUpperCase()) || !Number.isFinite(amount))
    throw new Error("Invalid monetary amount");
  const digits = new Intl.NumberFormat("en", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).resolvedOptions().maximumFractionDigits;
  const minor = Math.round(amount * 10 ** (digits ?? 2));
  if (!Number.isSafeInteger(minor))
    throw new Error("Monetary amount out of range");
  return minor;
}
export function currencyAmount(minor: number, currency: string) {
  const digits = new Intl.NumberFormat("en", {
    style: "currency",
    currency,
  }).resolvedOptions().maximumFractionDigits;
  return minor / 10 ** (digits ?? 2);
}
