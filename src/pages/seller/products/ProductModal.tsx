import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import type { SellerProduct } from "@/api/sellerProducts";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v && String(v).trim().length ? String(v).trim() : null));

const optionalNumber = z.preprocess(
  (val) => (val === "" || val === null ? null : val),
  z.coerce.number().min(0).optional().nullable(),
);

const baseSchema = z.object({
  name: z.string().trim().min(1).max(200),
  salla_product_id: z
    .string()
    .trim()
    .max(64)
    .optional()
    .nullable()
    .transform((v) => (v && String(v).trim().length ? String(v).trim() : null)),
  sku: optionalText(80),
  handler: z.string().trim().min(1).max(40).optional().default("smm"),
  product_type: optionalText(80),
  category: optionalText(80),
  base_price: optionalNumber,
  base_cost: optionalNumber,
  description: optionalText(2000),
  status: z.enum(["active", "inactive"]).default("active"),
});

type FormValues = z.infer<typeof baseSchema>;

export default function ProductModal(props: {
  mode: "create" | "edit";
    product?: SellerProduct | null;
  trigger: React.ReactNode;
    onSubmit: (values: {
    name: string;
    salla_product_id?: string | null;
    sku?: string | null;
    handler?: string;
    product_type?: string | null;
    category?: string | null;
    base_price?: number | null;
    base_cost?: number | null;
    description?: string | null;
    status: "active" | "inactive";
  }) => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === "ar";
  const [open, setOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const schema = useMemo(() => baseSchema, []);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: props.product?.name ?? "",
      salla_product_id: props.product?.salla_product_id ?? null,
      sku: props.product?.sku ?? null,
      handler: props.product?.handler ?? "smm",
      product_type: props.product?.product_type ?? null,
      category: props.product?.category ?? null,
      base_price: props.product?.base_price ?? null,
      base_cost: props.product?.base_cost ?? null,
      description: props.product?.description ?? null,
      status: props.product?.status ?? "active",
    },
  });

  useEffect(() => {
    form.reset({
      name: props.product?.name ?? "",
      salla_product_id: props.product?.salla_product_id ?? null,
      sku: props.product?.sku ?? null,
      handler: props.product?.handler ?? "smm",
      product_type: props.product?.product_type ?? null,
      category: props.product?.category ?? null,
      base_price: props.product?.base_price ?? null,
      base_cost: props.product?.base_cost ?? null,
      description: props.product?.description ?? null,
      status: props.product?.status ?? "active",
    });
  }, [open, props.product, form]);

  const handleSubmit = form.handleSubmit(
    async (values) => {
      setSubmitError(null);
      try {
        const sku = values.sku ?? values.salla_product_id ?? null;
        await props.onSubmit({ ...values, sku });
        setOpen(false);
        form.reset();
      } catch (e) {
        const message = e instanceof Error ? e.message : t("common.error");
        setSubmitError(message);
      }
    },
    () => {
      setSubmitError(t("common.error"));
    },
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{props.trigger}</DialogTrigger>
      <DialogContent className="max-h-[85vh] w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] overflow-y-auto overflow-x-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{props.mode === "create" ? t("seller.products.addTitle") : t("seller.products.editTitle")}</DialogTitle>
          <DialogDescription>{t("seller.products.modalHint")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="name">{t("seller.products.fields.name")}</Label>
              <Input id="name" {...form.register("name")} placeholder={t("seller.products.placeholders.name")} />
              {form.formState.errors.name?.message && <p className="text-sm text-destructive">{String(form.formState.errors.name.message)}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="salla">
                {t("seller.products.fields.sallaProductId")} <span className="text-muted-foreground">(معرف منتج سلة)</span>
              </Label>
              <Input id="salla" {...form.register("salla_product_id")} placeholder={t("seller.products.placeholders.sallaProductId")} />
              {form.formState.errors.salla_product_id?.message && (
                <p className="text-sm text-destructive">{String(form.formState.errors.salla_product_id.message)}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label>{t("seller.products.fields.handler")}</Label>
              <Select value={form.watch("handler")} onValueChange={(v) => form.setValue("handler", v)}>
                <SelectTrigger>
                  <SelectValue placeholder={t("seller.products.placeholders.handler")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="smm">{t("seller.products.handlers.smm")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="category">{t("seller.products.fields.category")}</Label>
              <Input id="category" {...form.register("category")} placeholder={t("seller.products.placeholders.category")} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="product_type">{t("seller.products.fields.productType")}</Label>
              <Input id="product_type" {...form.register("product_type")} placeholder={t("seller.products.placeholders.productType")} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="base_price">{t("seller.products.fields.basePrice")}</Label>
              <Input id="base_price" type="number" inputMode="decimal" {...form.register("base_price")} placeholder={t("seller.products.placeholders.basePrice")} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="base_cost">{t("seller.products.fields.baseCost")}</Label>
              <Input id="base_cost" type="number" inputMode="decimal" {...form.register("base_cost")} placeholder={t("seller.products.placeholders.baseCost")} />
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="description">{t("seller.products.fields.description")}</Label>
              <Textarea id="description" {...form.register("description")} placeholder={t("seller.products.placeholders.description")} />
            </div>
          </div>

          {submitError && (
            <p className="text-sm text-destructive" role="alert">
              {submitError}
            </p>
          )}

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">{t("seller.products.fields.enabled")}</p>
              <p className="text-xs text-muted-foreground">{t("seller.products.hints.enabled")}</p>
            </div>
            <Switch
              checked={form.watch("status") === "active"}
              onCheckedChange={(checked) => form.setValue("status", checked ? "active" : "inactive")}
            />
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
