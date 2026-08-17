import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Pencil, Trash2 } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  useCreateSellerProductRule,
  useDeleteSellerProductRule,
  useBulkUpdateSellerRuleService,
  useBulkUpdateSellerRuleServiceByName,
  useSellerProductRules,
  useSellerSmmProviders,
  useUpdateSellerProductRule,
} from "@/hooks/useApi";
import type { SellerProduct, SmmProductRule } from "@/api/sellerProducts";

import RuleModal, { RuleFormValues } from "./RuleModal";

function parseConditionsCount(rule: SmmProductRule) {
  if (!rule.conditions_json) return 0;
  try {
    const parsed = JSON.parse(rule.conditions_json);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

export default function RulesCard(props: { productId: string; products: SellerProduct[] }) {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === "ar";
  const providersQuery = useSellerSmmProviders();
  const rulesQuery = useSellerProductRules(props.productId);
  const createMutation = useCreateSellerProductRule();
  const updateMutation = useUpdateSellerProductRule();
  const deleteMutation = useDeleteSellerProductRule();
  const bulkUpdateService = useBulkUpdateSellerRuleService();
  const bulkUpdateServiceByName = useBulkUpdateSellerRuleServiceByName();

  const providers = providersQuery.data ?? [];
  const rules = rulesQuery.data ?? [];

  const providerNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of providers) map.set(p.id, p.name);
    return map;
  }, [providers]);

  const handleCreate = async (values: RuleFormValues) => {
    try {
      await createMutation.mutateAsync({
        productId: props.productId,
        input: {
          provider_connection_id: values.provider_connection_id,
          provider_service_id: values.provider_service_id,
          service_name: values.service_name,
          target_value: values.target_value ?? null,
          quantity_type: values.quantity_type,
          quantity_value: values.quantity_value ?? null,
          quantity_field: values.quantity_field ?? null,
          delay_seconds: values.delay_seconds,
          execution_order: values.execution_order,
          normalize_url: values.normalize_url,
          url_handler: values.url_handler ?? null,
          conditions: values.conditions ?? [],
        },
      });
      toast({ title: t("common.success"), description: t("seller.products.rules.toasts.created") });
    } catch (e: any) {
      toast({ title: t("common.error"), description: e.message, variant: "destructive" });
    }
  };

  const handleEdit = async (ruleId: string, values: RuleFormValues) => {
    try {
      await updateMutation.mutateAsync({
        ruleId,
        input: {
          provider_connection_id: values.provider_connection_id,
          provider_service_id: values.provider_service_id,
          service_name: values.service_name,
          target_value: values.target_value ?? null,
          quantity_type: values.quantity_type,
          quantity_value: values.quantity_value ?? null,
          quantity_field: values.quantity_field ?? null,
          delay_seconds: values.delay_seconds,
          execution_order: values.execution_order,
          normalize_url: values.normalize_url,
          url_handler: values.url_handler ?? null,
          conditions: values.conditions ?? [],
        },
      });
      toast({ title: t("common.success"), description: t("seller.products.rules.toasts.updated") });
    } catch (e: any) {
      toast({ title: t("common.error"), description: e.message, variant: "destructive" });
    }
  };

  const handleBulkUpdateService = async (input: {
    provider_connection_id: string;
    from_provider_service_id: number;
    to_provider_service_id: number;
    to_service_name: string;
    mode: "all_matching" | "products";
    product_ids?: string[];
  }) => {
    try {
      const res = await bulkUpdateService.mutateAsync(input);
      toast({ title: t("common.success"), description: `${t("common.updated")}: ${res.updated}` });
    } catch (e: any) {
      toast({ title: t("common.error"), description: e.message, variant: "destructive" });
      throw e;
    }
  };

  const handleBulkUpdateServiceByName = async (input: {
    provider_connection_id: string;
    rule_name: string;
    to_provider_service_id: number;
    mode: "all_matching" | "products";
    product_ids?: string[];
  }) => {
    try {
      const res = await bulkUpdateServiceByName.mutateAsync(input);
      toast({ title: t("common.success"), description: `${t("common.updated")}: ${res.updated}` });
    } catch (e: any) {
      toast({ title: t("common.error"), description: e.message, variant: "destructive" });
      throw e;
    }
  };

  const handleDelete = async (ruleId: string) => {
    try {
      await deleteMutation.mutateAsync(ruleId);
      toast({ title: t("common.success"), description: t("seller.products.rules.toasts.deleted") });
    } catch (e: any) {
      toast({ title: t("common.error"), description: e.message, variant: "destructive" });
    }
  };

  const canAddRule = providers.some((p) => p.is_active);

  return (
    <Card>
      <CardHeader className="gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>{t("seller.products.rules.title")}</CardTitle>
          <CardDescription>{t("seller.products.rules.subtitle")}</CardDescription>
        </div>
        <RuleModal
          mode="create"
          providers={providers}
          products={props.products}
          currentProductId={props.productId}
          onSubmit={handleCreate}
          trigger={
            <Button disabled={!canAddRule}>
              <Plus className={cn("h-4 w-4", isRTL ? "ml-2" : "mr-2")} />
              {t("seller.products.rules.addRule")}
            </Button>
          }
        />
      </CardHeader>
      <CardContent>
        {providersQuery.isLoading || rulesQuery.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : providers.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("seller.products.rules.noProviders")}</p>
        ) : rules.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("seller.products.rules.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("seller.products.rules.columns.service")}</TableHead>
                  <TableHead className="hidden lg:table-cell">{t("seller.products.rules.columns.provider")}</TableHead>
                  <TableHead className="hidden md:table-cell">{t("seller.products.rules.columns.quantity")}</TableHead>
                  <TableHead className="hidden xl:table-cell">{t("seller.products.rules.columns.delay")}</TableHead>
                  <TableHead className="hidden xl:table-cell">{t("seller.products.rules.columns.order")}</TableHead>
                  <TableHead className="hidden xl:table-cell">{t("seller.products.rules.columns.conditions")}</TableHead>
                  <TableHead className="text-right">{t("seller.products.rules.columns.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">
                      <div className="min-w-0">
                        <p className="truncate">{r.service_name}</p>
                        <p className="text-xs text-muted-foreground">#{r.provider_service_id}</p>
                      </div>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">{providerNameById.get(r.provider_connection_id) ?? r.provider_connection_id}</TableCell>
                    <TableCell className="hidden md:table-cell">
                      {r.quantity_type === "fixed" ? `${r.quantity_value ?? "?"}` : `${t("seller.products.rules.fromField")}: ${r.quantity_field ?? "?"}`}
                    </TableCell>
                    <TableCell className="hidden xl:table-cell">{r.delay_seconds}s</TableCell>
                    <TableCell className="hidden xl:table-cell">{r.execution_order}</TableCell>
                    <TableCell className="hidden xl:table-cell">{parseConditionsCount(r)}</TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex items-center gap-1">
                        <RuleModal
                          mode="edit"
                          providers={providers}
                          rule={r}
                          products={props.products}
                          currentProductId={props.productId}
                          onSubmit={(vals) => handleEdit(r.id, vals)}
                          onBulkUpdateService={handleBulkUpdateService}
                          onBulkUpdateServiceByName={handleBulkUpdateServiceByName}
                          trigger={
                            <Button variant="ghost" size="icon">
                              <Pencil className="h-4 w-4" />
                            </Button>
                          }
                        />
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>{t("seller.products.rules.deleteTitle")}</AlertDialogTitle>
                              <AlertDialogDescription>{t("seller.products.rules.deleteHint")}</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              {isRTL ? (
                                <>
                                  <AlertDialogAction onClick={() => handleDelete(r.id)} disabled={deleteMutation.isPending}>
                                    {t("common.delete")}
                                  </AlertDialogAction>
                                  <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                                </>
                              ) : (
                                <>
                                  <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => handleDelete(r.id)} disabled={deleteMutation.isPending}>
                                    {t("common.delete")}
                                  </AlertDialogAction>
                                </>
                              )}
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {!canAddRule && providers.length > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">{t("seller.products.rules.needActiveProvider")}</p>
        )}
      </CardContent>
    </Card>
  );
}
