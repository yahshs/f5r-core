import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check, ChevronsUpDown, Plus, RefreshCcw, Trash2 } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import type { SmmProviderConnection } from "@/types";
import type { SellerProduct, SmmProductRule, SmmRuleCondition } from "@/api/sellerProducts";
import { smmProvidersApi, type SmmProviderService } from "@/api/smmProviders";

function toLatinDigits(input: string) {
  return input
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
}

function parseIntish(val: unknown) {
  if (typeof val === "number") return Number.isFinite(val) ? val : undefined;
  if (typeof val !== "string") return undefined;
  const cleaned = toLatinDigits(val).trim().replace(/,/g, "");
  if (!cleaned) return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

function zInt(min: number, max?: number) {
  return z.preprocess(
    (v) => parseIntish(v),
    max === undefined ? z.number().int().min(min) : z.number().int().min(min).max(max),
  );
}

const conditionSchema = z.object({
  field: z.string().trim().min(1).max(60),
  op: z.enum(["equals", "contains", "gt", "lt"]),
  value: z.string().trim().min(1).max(200),
});

const baseSchema = z
  .object({
    provider_connection_id: z.string().trim().min(1),
    provider_service_id: zInt(1),
    service_name: z.string().trim().min(1).max(200),
    target_value: z
      .string()
      .trim()
      .max(500)
      .optional()
      .transform((v) => (v && v.length ? v : null))
      .nullable(),
    quantity_type: z.enum(["fixed", "from_field"]),
    quantity_value: z.preprocess((v) => (v === null ? null : parseIntish(v)), z.number().int().positive().nullable()).optional(),
    quantity_field: z.string().trim().min(1).max(60).optional().nullable(),
    delay_seconds: zInt(0, 86400).default(0),
    execution_order: zInt(1, 50).default(1),
    normalize_url: z.boolean().default(true),
    url_handler: z
      .string()
      .trim()
      .max(80)
      .optional()
      .transform((v) => (v && v.length ? v : null))
      .nullable(),
    conditions: z.array(conditionSchema).optional().nullable(),
  })
  .superRefine((val, ctx) => {
    if (val.quantity_type === "fixed" && !val.quantity_value) {
      ctx.addIssue({ code: "custom", path: ["quantity_value"], message: "quantity_value is required" });
    }
    if (val.quantity_type === "from_field" && !val.quantity_field) {
      ctx.addIssue({ code: "custom", path: ["quantity_field"], message: "quantity_field is required" });
    }
  });

export type RuleFormValues = z.infer<typeof baseSchema>;

function countryCodeToEmoji(code: string) {
  if (!/^[A-Z]{2}$/.test(code)) return code;
  const base = 0x1f1e6;
  const chars = code.split("").map((c) => String.fromCodePoint(base + c.charCodeAt(0) - 65));
  return chars.join("");
}

function normalizeFlags(text: string) {
  return text.replace(/\b([A-Z]{2})\b/g, (_match, code) => countryCodeToEmoji(code));
}

function renderTextWithFlags(text: string): React.ReactNode {
  const normalized = normalizeFlags(text);
  const flagRegex = /[\u{1F1E6}-\u{1F1FF}]{2}/gu;
  const matches = Array.from(normalized.matchAll(flagRegex));
  if (matches.length === 0) return text;

  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;

  for (const match of matches) {
    const index = match.index ?? 0;
    const value = match[0] ?? "";
    if (index > lastIndex) nodes.push(normalized.slice(lastIndex, index));
    nodes.push(
      <span key={`${index}-${value}`} className="emoji">
        {value}
      </span>,
    );
    lastIndex = index + value.length;
  }

  if (lastIndex < normalized.length) nodes.push(normalized.slice(lastIndex));
  return nodes;
}

function parseConditionsJson(conditionsJson: string | null): SmmRuleCondition[] {
  if (!conditionsJson) return [];
  try {
    const parsed = JSON.parse(conditionsJson);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(Boolean);
  } catch {
    return [];
  }
}

export default function RuleModal(props: {
  mode: "create" | "edit";
  providers: SmmProviderConnection[];
  rule?: SmmProductRule | null;
  products?: SellerProduct[];
  currentProductId?: string;
  trigger: React.ReactNode;
  onSubmit: (values: RuleFormValues) => Promise<void>;
  onBulkUpdateService?: (input: {
    provider_connection_id: string;
    from_provider_service_id: number;
    to_provider_service_id: number;
    to_service_name: string;
    mode: "all_matching" | "products";
    product_ids?: string[];
  }) => Promise<void>;
  onBulkUpdateServiceByName?: (input: {
    provider_connection_id: string;
    rule_name: string;
    to_provider_service_id: number;
    mode: "all_matching" | "products";
    product_ids?: string[];
  }) => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === "ar";
  const [open, setOpen] = useState(false);
  const [servicesOpen, setServicesOpen] = useState(false);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [services, setServices] = useState<SmmProviderService[] | null>(null);
  const [applyMode, setApplyMode] = useState<"single" | "all_matching" | "products" | "all_by_name" | "products_by_name">("single");
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);

  const schema = useMemo(() => baseSchema, []);
  const defaults = useMemo<RuleFormValues>(
    () => ({
      provider_connection_id: props.rule?.provider_connection_id ?? props.providers[0]?.id ?? "",
      provider_service_id: props.rule?.provider_service_id ?? 1,
      service_name: props.rule?.service_name ?? "",
      target_value: null,
      quantity_type: props.rule?.quantity_type ?? "fixed",
      quantity_value: props.rule?.quantity_value ?? null,
      quantity_field: props.rule?.quantity_field ?? null,
      delay_seconds: props.rule?.delay_seconds ?? 0,
      execution_order: props.rule?.execution_order ?? 1,
      normalize_url: props.rule ? props.rule.normalize_url === 1 : true,
      url_handler: null,
      conditions: props.rule ? parseConditionsJson(props.rule.conditions_json) : [],
    }),
    [props.rule, props.providers],
  );

  const form = useForm<RuleFormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaults,
  });

  useEffect(() => {
    if (!open) return;
    form.reset(defaults);
    setServices(null);
    setServicesOpen(false);
    setApplyMode("single");
    setSelectedProductIds(props.currentProductId ? [props.currentProductId] : []);
  }, [open, defaults, form, props.currentProductId]);

  const conditionsArray = useFieldArray({ control: form.control, name: "conditions" });

  const handleSubmit = form.handleSubmit(async (values) => {
    if (values.quantity_type === "fixed") {
      const q = values.quantity_value ?? null;
      const min = selectedService?.min ?? null;
      const max = selectedService?.max ?? null;
      if (typeof q === "number" && Number.isFinite(q)) {
        if (min !== null && q < min) {
          form.setError("quantity_value", { type: "validate", message: `Min is ${min}` });
          return;
        }
        if (max !== null && q > max) {
          form.setError("quantity_value", { type: "validate", message: `Max is ${max}` });
          return;
        }
      }
    }
    const normalized: RuleFormValues = {
      ...values,
      target_value: null,
      url_handler: null,
      conditions: values.conditions?.filter((c) => c.field && c.op && c.value) ?? [],
    };

    if (props.mode === "edit" && applyMode !== "single" && props.rule) {
      const provider_connection_id = props.rule.provider_connection_id;
      const from_provider_service_id = props.rule.provider_service_id;
      const to_provider_service_id = Number(values.provider_service_id);

      if (!Number.isFinite(to_provider_service_id) || to_provider_service_id <= 0) {
        form.setError("provider_service_id", { type: "validate", message: "Invalid service id" });
        return;
      }

      if (applyMode === "products" || applyMode === "products_by_name") {
        const ids = (selectedProductIds.length ? selectedProductIds : props.currentProductId ? [props.currentProductId] : []).filter(Boolean);
        if (!ids.length) {
          form.setError("provider_service_id", { type: "validate", message: "Pick at least one product" });
          return;
        }
        if (applyMode === "products_by_name") {
          if (!props.onBulkUpdateServiceByName) return;
          await props.onBulkUpdateServiceByName({
            provider_connection_id,
            rule_name: props.rule.service_name,
            to_provider_service_id,
            mode: "products",
            product_ids: ids,
          });
        } else {
          if (!props.onBulkUpdateService) return;
          await props.onBulkUpdateService({
            provider_connection_id,
            from_provider_service_id,
            to_provider_service_id,
            to_service_name: values.service_name,
            mode: "products",
            product_ids: ids,
          });
        }
      } else {
        if (applyMode === "all_by_name") {
          if (!props.onBulkUpdateServiceByName) return;
          await props.onBulkUpdateServiceByName({
            provider_connection_id,
            rule_name: props.rule.service_name,
            to_provider_service_id,
            mode: "all_matching",
          });
        } else {
          if (!props.onBulkUpdateService) return;
          await props.onBulkUpdateService({
            provider_connection_id,
            from_provider_service_id,
            to_provider_service_id,
            to_service_name: values.service_name,
            mode: "all_matching",
          });
        }
      }
    } else {
      await props.onSubmit(normalized);
    }
    setOpen(false);
  });

  const quantityType = form.watch("quantity_type");
  const selectedProviderId = form.watch("provider_connection_id");
  const selectedServiceId = form.watch("provider_service_id");
  const canBulkEdit =
    props.mode === "edit" &&
    (props.products?.length ?? 0) > 1 &&
    (!!props.onBulkUpdateService || !!props.onBulkUpdateServiceByName);

  const selectedService = useMemo(() => {
    if (!services || !selectedServiceId) return null;
    return services.find((s) => s.id === Number(selectedServiceId)) ?? null;
  }, [services, selectedServiceId]);

  useEffect(() => {
    if (!open) return;
    if (quantityType !== "fixed") return;
    const min = selectedService?.min ?? null;
    if (min === null) return;
    const q = form.getValues("quantity_value");
    if (typeof q === "number" && Number.isFinite(q) && q >= min) return;
    form.setValue("quantity_value", min, { shouldDirty: true, shouldValidate: true });
  }, [open, quantityType, selectedService?.min, form]);

  const loadServices = async () => {
    if (!selectedProviderId) return;
    setServicesLoading(true);
    try {
      const list = await smmProvidersApi.listServices(selectedProviderId);
      setServices(list);
      setServicesOpen(true);
    } finally {
      setServicesLoading(false);
    }
  };

  return (
      <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{props.trigger}</DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-4xl lg:max-w-5xl xl:max-w-6xl">
        <DialogHeader>
          <DialogTitle>{props.mode === "create" ? t("seller.products.rules.addTitle") : t("seller.products.rules.editTitle")}</DialogTitle>
          <DialogDescription>{t("seller.products.rules.modalHint")}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <div className="flex min-h-[36px] items-center justify-between gap-2">
                <Label>{t("seller.products.rules.fields.provider")}</Label>
                <span className="h-9 w-20" aria-hidden />
              </div>
              <Select
                value={form.watch("provider_connection_id")}
                onValueChange={(v) => form.setValue("provider_connection_id", v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("seller.products.rules.placeholders.provider")} />
                </SelectTrigger>
                <SelectContent>
                  {props.providers.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.formState.errors.provider_connection_id?.message && (
                <p className="text-sm text-destructive">{String(form.formState.errors.provider_connection_id.message)}</p>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex min-h-[36px] items-center justify-between gap-2">
                <Label htmlFor="service_name">{t("seller.products.rules.fields.serviceName")}</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className={cn("gap-2", isRTL && "flex-row-reverse")}
                  disabled={!selectedProviderId || servicesLoading}
                  onClick={async () => {
                    try {
                      await loadServices();
                    } catch (e) {
                      const msg = e instanceof Error ? e.message : t("common.error");
                      form.setError("service_name", { type: "custom", message: msg });
                    }
                  }}
                >
                  <RefreshCcw className="h-4 w-4" />
                  {t("seller.products.rules.fetchServices")}
                </Button>
              </div>

              <Popover open={servicesOpen} onOpenChange={setServicesOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    className={cn("w-full justify-between", isRTL && "flex-row-reverse")}
                    disabled={!selectedProviderId}
                  >
                    <span className={cn("truncate", isRTL ? "text-right" : "text-left")}>
                      {selectedService ? (
                        <>
                          {renderTextWithFlags(selectedService.name)} #{selectedService.id}
                        </>
                      ) : (
                        t("seller.products.rules.servicePickerPlaceholder")
                      )}
                    </span>
                    <ChevronsUpDown className="h-4 w-4 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="p-0 max-h-[360px] overflow-hidden w-[min(860px,calc(100vw-2rem))]"
                  align="start"
                  onWheelCapture={(e) => e.stopPropagation()}
                  onTouchMoveCapture={(e) => e.stopPropagation()}
                >
                  <Command className="max-h-[360px] overflow-hidden">
                    <CommandInput placeholder={t("seller.products.rules.serviceSearchPlaceholder")} />
                    <CommandList
                      className="max-h-[300px] overflow-y-auto overscroll-contain touch-pan-y"
                      onWheelCapture={(e) => e.stopPropagation()}
                      onTouchMoveCapture={(e) => e.stopPropagation()}
                    >
                      <CommandEmpty>{t("seller.products.rules.serviceSearchEmpty")}</CommandEmpty>
                      <CommandGroup>
                        {(services ?? []).slice(0, 2500).map((s) => (
                          <CommandItem
                            key={s.id}
                            value={`${s.id} ${s.name} ${s.category ?? ""}`}
                            onSelect={() => {
                              form.setValue("provider_service_id", s.id, { shouldValidate: true });
                              form.setValue("service_name", s.name, { shouldValidate: true });
                              setServicesOpen(false);
                            }}
                          >
                            <Check className={cn(isRTL ? "ml-2" : "mr-2", "h-4 w-4", Number(selectedServiceId) === s.id ? "opacity-100" : "opacity-0")} />
                            <div className="min-w-0">
                              <div className="flex items-center justify-between gap-2">
                                <span className="break-words whitespace-normal leading-snug">{renderTextWithFlags(s.name)}</span>
                                <span className="shrink-0 text-xs text-muted-foreground">#{s.id}</span>
                              </div>
                              {s.category && (
                                <div className="truncate text-xs text-muted-foreground">{renderTextWithFlags(s.category)}</div>
                              )}
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>

              <Input id="service_name" {...form.register("service_name")} placeholder={t("seller.products.rules.placeholders.serviceName")} />
              {form.formState.errors.service_name?.message && (
                <p className="text-sm text-destructive">{String(form.formState.errors.service_name.message)}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="provider_service_id">{t("seller.products.rules.fields.providerServiceId")}</Label>
              <Input id="provider_service_id" inputMode="numeric" {...form.register("provider_service_id")} />
              {form.formState.errors.provider_service_id?.message && (
                <p className="text-sm text-destructive">{String(form.formState.errors.provider_service_id.message)}</p>
              )}
            </div>

            {canBulkEdit ? (
              <div className="space-y-2">
                <Label>{t("seller.products.rules.fields.applyTo")}</Label>
                <Select value={applyMode} onValueChange={(v) => setApplyMode(v as any)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="single">{t("seller.products.rules.applyModes.single")}</SelectItem>
                    <SelectItem value="all_matching">{t("seller.products.rules.applyModes.allMatching")}</SelectItem>
                    <SelectItem value="products">{t("seller.products.rules.applyModes.products")}</SelectItem>
                    <SelectItem value="all_by_name">{t("seller.products.rules.applyModes.allByName")}</SelectItem>
                    <SelectItem value="products_by_name">{t("seller.products.rules.applyModes.productsByName")}</SelectItem>
                  </SelectContent>
                </Select>
                {applyMode === "products" || applyMode === "products_by_name" ? (
                  <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border p-2">
                    {(props.products ?? []).map((p) => {
                      const checked = selectedProductIds.includes(p.id);
                      return (
                        <label key={p.id} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-primary"
                            checked={checked}
                            onChange={(e) => {
                              const next = e.target.checked
                                ? Array.from(new Set([...selectedProductIds, p.id]))
                                : selectedProductIds.filter((x) => x !== p.id);
                              setSelectedProductIds(next);
                            }}
                          />
                          <span className="truncate">{p.name}</span>
                        </label>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="space-y-2">
              <Label>{t("seller.products.rules.fields.quantityType")}</Label>
              <Select
                value={quantityType}
                onValueChange={(v) => {
                  form.setValue("quantity_type", v as any);
                  if (v === "fixed") {
                    form.setValue("quantity_field", null);
                  } else {
                    form.setValue("quantity_value", null);
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("seller.products.rules.placeholders.quantityType")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fixed">{t("seller.products.rules.quantityTypes.fixed")}</SelectItem>
                  <SelectItem value="from_field">{t("seller.products.rules.quantityTypes.fromField")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {quantityType === "fixed" ? (
              <div className="space-y-2">
                <Label htmlFor="quantity_value">{t("seller.products.rules.fields.quantityValue")}</Label>
                <Input
                  id="quantity_value"
                  inputMode="numeric"
                  placeholder="100"
                  {...form.register("quantity_value")}
                />
                {form.formState.errors.quantity_value?.message && (
                  <p className="text-sm text-destructive">{String(form.formState.errors.quantity_value.message)}</p>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="quantity_field">{t("seller.products.rules.fields.quantityField")}</Label>
                <Input id="quantity_field" {...form.register("quantity_field")} placeholder={t("seller.products.rules.placeholders.quantityField")} />
                {form.formState.errors.quantity_field?.message && (
                  <p className="text-sm text-destructive">{String(form.formState.errors.quantity_field.message)}</p>
                )}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="delay_seconds">{t("seller.products.rules.fields.delaySeconds")}</Label>
              <Input id="delay_seconds" inputMode="numeric" {...form.register("delay_seconds")} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="execution_order">{t("seller.products.rules.fields.executionOrder")}</Label>
              <Input id="execution_order" inputMode="numeric" {...form.register("execution_order")} />
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3 sm:col-span-2">
              <div>
                <p className="text-sm font-medium">{t("seller.products.rules.fields.normalizeUrl")}</p>
                <p className="text-xs text-muted-foreground">{t("seller.products.rules.hints.normalizeUrl")}</p>
              </div>
              <Switch checked={form.watch("normalize_url")} onCheckedChange={(v) => form.setValue("normalize_url", v)} />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{t("seller.products.rules.fields.conditions")}</p>
                <p className="text-xs text-muted-foreground">{t("seller.products.rules.hints.conditions")}</p>
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={() => conditionsArray.append({ field: "", op: "equals", value: "" })}
              >
                <Plus className={cn("h-4 w-4", isRTL ? "ml-2" : "mr-2")} />
                {t("seller.products.rules.addCondition")}
              </Button>
            </div>

            {conditionsArray.fields.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("seller.products.rules.noConditions")}</p>
            ) : (
              <div className="space-y-2">
                {conditionsArray.fields.map((f, idx) => (
                  <div key={f.id} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-12">
                    <div className="sm:col-span-4">
                      <Label className="text-xs">{t("seller.products.rules.condition.field")}</Label>
                      <Input {...form.register(`conditions.${idx}.field` as const)} placeholder={t("seller.products.rules.condition.fieldPlaceholder")} />
                    </div>
                    <div className="sm:col-span-3">
                      <Label className="text-xs">{t("seller.products.rules.condition.op")}</Label>
                      <Select
                        value={form.watch(`conditions.${idx}.op` as const)}
                        onValueChange={(v) => form.setValue(`conditions.${idx}.op` as const, v as any)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="equals">{t("seller.products.rules.ops.equals")}</SelectItem>
                          <SelectItem value="contains">{t("seller.products.rules.ops.contains")}</SelectItem>
                          <SelectItem value="gt">{t("seller.products.rules.ops.gt")}</SelectItem>
                          <SelectItem value="lt">{t("seller.products.rules.ops.lt")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="sm:col-span-4">
                      <Label className="text-xs">{t("seller.products.rules.condition.value")}</Label>
                      <Input {...form.register(`conditions.${idx}.value` as const)} placeholder={t("seller.products.rules.condition.valuePlaceholder")} />
                    </div>
                    <div className="flex items-end sm:col-span-1">
                      <Button type="button" variant="ghost" size="icon" onClick={() => conditionsArray.remove(idx)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter>
            {isRTL ? (
              <>
                <Button type="submit" disabled={form.formState.isSubmitting}>
                  {t("common.save")}
                </Button>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  {t("common.cancel")}
                </Button>
              </>
            ) : (
              <>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  {t("common.cancel")}
                </Button>
                <Button type="submit" disabled={form.formState.isSubmitting}>
                  {t("common.save")}
                </Button>
              </>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
