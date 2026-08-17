import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Search } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import {
  useCreateSellerProduct,
  useDeleteSellerProduct,
  useSellerProducts,
  useUpdateSellerProduct,
} from "@/hooks/useApi";
import type { SellerProduct } from "@/api/sellerProducts";

import ProductModal from "./ProductModal";
import RulesCard from "./RulesCard";

function statusBadge(t: (key: string) => string, status: SellerProduct["status"]) {
  return status === "active" ? (
    <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
      {t("common.active")}
    </Badge>
  ) : (
    <Badge variant="secondary" className="bg-rose-500/10 text-rose-700 dark:text-rose-400">
      {t("common.inactive")}
    </Badge>
  );
}

export default function ProductsPage() {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === "ar";
  const listQuery = useSellerProducts();
  const createMutation = useCreateSellerProduct();
  const updateMutation = useUpdateSellerProduct();
  const deleteMutation = useDeleteSellerProduct();

  const products = listQuery.data ?? [];
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedId && products.length) setSelectedId(products[0].id);
    if (selectedId && products.length && !products.some((p) => p.id === selectedId)) {
      setSelectedId(products[0].id);
    }
  }, [products, selectedId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) =>
      `${p.name} ${p.salla_product_id ?? ""} ${p.sku ?? ""} ${p.category ?? ""} ${p.product_type ?? ""}`
        .toLowerCase()
        .includes(q),
    );
  }, [products, query]);

  const selected = products.find((p) => p.id === selectedId) ?? null;

  const handleCreate = async (values: {
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
  }) => {
    try {
      const created = await createMutation.mutateAsync(values);
      toast({ title: t("common.success"), description: t("seller.products.toasts.created") });
      setSelectedId(created.id);
    } catch (e: any) {
      toast({ title: t("common.error"), description: e.message, variant: "destructive" });
      throw e;
    }
  };

  const handleEdit = async (
    id: string,
    values: {
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
    },
  ) => {
    try {
      await updateMutation.mutateAsync({ id, input: values });
      toast({ title: t("common.success"), description: t("seller.products.toasts.updated") });
    } catch (e: any) {
      toast({ title: t("common.error"), description: e.message, variant: "destructive" });
      throw e;
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteMutation.mutateAsync(id);
      toast({ title: t("common.success"), description: t("seller.products.toasts.deleted") });
    } catch (e: any) {
      toast({ title: t("common.error"), description: e.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("seller.nav.products")}</h1>
          <p className="text-sm text-muted-foreground">{t("seller.products.subtitle")}</p>
        </div>
        <ProductModal
          mode="create"
          onSubmit={handleCreate}
          trigger={
            <Button className="w-full sm:w-auto">
              <Plus className={cn("h-4 w-4", isRTL ? "ml-2" : "mr-2")} />
              {t("seller.products.addProduct")}
            </Button>
          }
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        <Card className="lg:col-span-4">
          <CardHeader className="gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>{t("seller.products.listTitle")}</CardTitle>
              <CardDescription>{t("seller.products.listHint")}</CardDescription>
            </div>
            <div className="relative w-full sm:w-56">
              <Search
                className={cn(
                  "absolute top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground",
                  isRTL ? "right-3" : "left-3",
                )}
              />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className={cn(isRTL ? "pr-9" : "pl-9")}
                placeholder={t("seller.products.searchPlaceholder")}
              />
            </div>
          </CardHeader>
          <CardContent>
            {listQuery.isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("seller.products.empty")}</p>
            ) : (
              <div className="space-y-2">
                {filtered.map((p) => {
                  const isActive = selectedId === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSelectedId(p.id)}
                      className={cn(
                        "flex w-full items-start justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-colors",
                        isActive ? "border-primary bg-primary/5" : "hover:bg-muted",
                      )}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{p.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {p.salla_product_id ? `${t("seller.products.sallaId")}: ${p.salla_product_id}` : t("seller.products.noSallaId")}
                        </p>
                      </div>
                      {statusBadge(t, p.status)}
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6 lg:col-span-8">
          <Card>
            <CardHeader>
              <CardTitle>{t("seller.products.detailsTitle")}</CardTitle>
              <CardDescription>{selected ? t("seller.products.detailsHint") : t("seller.products.selectHint")}</CardDescription>
            </CardHeader>
            <CardContent>
              {!selected ? (
                <p className="text-sm text-muted-foreground">{t("seller.products.selectHint")}</p>
              ) : (
                <div className="space-y-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-lg font-semibold">{selected.name}</p>
                      <p className="text-sm text-muted-foreground">{selected.salla_product_id ?? t("seller.products.noSallaId")}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <ProductModal
                        mode="edit"
                        product={selected}
                        onSubmit={(values) => handleEdit(selected.id, values)}
                        trigger={
                          <Button variant="outline" className="w-full sm:w-auto">
                            {t("common.edit")}
                          </Button>
                        }
                      />
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="destructive" disabled={deleteMutation.isPending} className="w-full sm:w-auto">
                            {t("common.delete")}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>{t("seller.products.deleteTitle")}</AlertDialogTitle>
                            <AlertDialogDescription>{t("seller.products.deleteHint")}</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            {isRTL ? (
                              <>
                                <AlertDialogAction onClick={() => handleDelete(selected.id)} disabled={deleteMutation.isPending}>
                                  {t("common.delete")}
                                </AlertDialogAction>
                                <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                              </>
                            ) : (
                              <>
                                <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                                <AlertDialogAction onClick={() => handleDelete(selected.id)} disabled={deleteMutation.isPending}>
                                  {t("common.delete")}
                                </AlertDialogAction>
                              </>
                            )}
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <div className="rounded-lg border p-3">
                      <p className="text-xs text-muted-foreground">{t("seller.products.fields.status")}</p>
                      <div className="mt-1">{statusBadge(t, selected.status)}</div>
                    </div>
                    <div className="rounded-lg border p-3">
                      <p className="text-xs text-muted-foreground">{t("seller.products.fields.sku")}</p>
                      <p className="mt-1 break-words text-sm">{selected.sku ?? "-"}</p>
                    </div>
                    <div className="rounded-lg border p-3">
                      <p className="text-xs text-muted-foreground">{t("seller.products.fields.handler")}</p>
                      <p className="mt-1 break-words text-sm">
                        {selected.handler ? (selected.handler === "smm" ? t("seller.products.handlers.smm") : selected.handler) : "-"}
                      </p>
                    </div>
                    <div className="rounded-lg border p-3">
                      <p className="text-xs text-muted-foreground">{t("seller.products.fields.category")}</p>
                      <p className="mt-1 break-words text-sm">{selected.category ?? "-"}</p>
                    </div>
                    <div className="rounded-lg border p-3">
                      <p className="text-xs text-muted-foreground">{t("seller.products.fields.productType")}</p>
                      <p className="mt-1 break-words text-sm">{selected.product_type ?? "-"}</p>
                    </div>
                    <div className="rounded-lg border p-3">
                      <p className="text-xs text-muted-foreground">{t("seller.products.fields.basePrice")}</p>
                      <p className="mt-1 break-words text-sm">{selected.base_price ?? "-"}</p>
                    </div>
                    <div className="rounded-lg border p-3">
                      <p className="text-xs text-muted-foreground">{t("seller.products.fields.baseCost")}</p>
                      <p className="mt-1 break-words text-sm">{selected.base_cost ?? "-"}</p>
                    </div>
                    <div className="rounded-lg border p-3">
                      <p className="text-xs text-muted-foreground">{t("seller.products.fields.updatedAt")}</p>
                      <p className="mt-1 text-sm">{new Date(selected.updated_at).toLocaleString()}</p>
                    </div>
                  </div>

                  {selected.description ? (
                    <div className="rounded-lg border p-3">
                      <p className="text-xs text-muted-foreground">{t("seller.products.fields.description")}</p>
                      <p className="mt-1 break-words text-sm leading-relaxed">{selected.description}</p>
                    </div>
                  ) : null}
                </div>
              )}
            </CardContent>
          </Card>

          {selected ? <RulesCard productId={selected.id} products={products} /> : null}
        </div>
      </div>
    </div>
  );
}
