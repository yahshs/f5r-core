import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { SellerOrder } from "@/api/orders";
import type { OrderStatus } from "@/types";
import { useIsMobile } from "@/hooks/use-mobile";

type OrderDetailsDialogProps = {
  order: SellerOrder;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

function statusLabel(t: (key: string, options?: any) => string, status: OrderStatus) {
  return t(`orders.status.${status}`, { defaultValue: status });
}

function statusColor(status: OrderStatus) {
  if (status === "completed") return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
  if (status === "failed" || status === "cancelled") return "bg-rose-500/10 text-rose-700 dark:text-rose-400";
  if (status === "in_progress" || status === "approved" || status === "submitted") {
    return "bg-sky-500/10 text-sky-700 dark:text-sky-400";
  }
  return "bg-amber-500/10 text-amber-700 dark:text-amber-400";
}

function fulfillmentColor(status: string | null) {
  if (status === "SUCCESS") return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
  if (status === "FAILED") return "bg-rose-500/10 text-rose-700 dark:text-rose-400";
  if (status === "SUBMITTED") return "bg-sky-500/10 text-sky-700 dark:text-sky-400";
  if (status === "PARTIAL") return "bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-400";
  return "bg-amber-500/10 text-amber-700 dark:text-amber-400";
}

function routingReasonLabel(t: (key: string, options?: any) => string, reason?: string | null) {
  if (!reason) return null;
  return t(`orders.details.routing.reasons.${reason}`, { defaultValue: reason });
}

export default function OrderDetailsDialog({ order, trigger, open, onOpenChange }: OrderDetailsDialogProps) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const createdAt = useMemo(() => new Date(order.created_at).toLocaleString(), [order.created_at]);
  const updatedAt = useMemo(() => new Date(order.updated_at).toLocaleString(), [order.updated_at]);
  const routingState = order.routing?.state ?? null;
  const isUnrouted = routingState === "unrouted";
  const routingReasons = order.routing?.reasons ?? null;
  const routingReasonEntries = useMemo(() => {
    if (!routingReasons) return [];
    const entries: Array<{ key: string; count: number }> = [
      { key: "unmapped_product", count: routingReasons.unmapped_product },
      { key: "product_inactive", count: routingReasons.product_inactive },
      { key: "no_rule", count: routingReasons.no_rule },
      { key: "provider_inactive", count: routingReasons.provider_inactive },
      { key: "ready", count: routingReasons.ready },
      { key: "already_routed", count: routingReasons.already_routed },
    ];
    return entries.filter((e) => e.count > 0);
  }, [routingReasons]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] overflow-x-hidden overflow-y-auto sm:max-w-5xl lg:max-w-6xl">
        <DialogHeader>
          <DialogTitle>{t("orders.details.title")}</DialogTitle>
          <DialogDescription>{t("orders.details.subtitle")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground">{t("orders.details.summary")}</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">{t("orders.details.fields.orderId")}</p>
                <p className="break-all text-sm font-medium">{order.salla_order_id ?? order.id}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">{t("orders.details.fields.internalId")}</p>
                <p className="break-all text-sm font-medium">{order.internal_id ?? "-"}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">{t("orders.details.fields.status")}</p>
                <Badge variant="secondary" className={statusColor(order.status)}>
                  {statusLabel(t, order.status)}
                </Badge>
              </div>
              {routingState ? (
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">{t("orders.details.routing.title")}</p>
                  <Badge
                    variant="secondary"
                    className={routingState === "routed" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-amber-500/10 text-amber-700 dark:text-amber-400"}
                  >
                    {routingState === "routed" ? t("orders.details.routing.routed") : t("orders.details.routing.unrouted")}
                  </Badge>
                  {routingState === "unrouted" && (order.routing?.unmapped_items ?? 0) > 0 ? (
                    <p className="mt-2 text-xs text-muted-foreground">{t("orders.details.routing.hintUnmapped")}</p>
                  ) : null}
                </div>
              ) : null}
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">{t("orders.details.fields.paymentStatus")}</p>
                <p className="text-sm font-medium">{order.payment_status ?? "-"}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">{t("orders.details.fields.total")}</p>
                <p className="text-sm font-medium">
                  {Number(order.totalPrice ?? 0).toFixed(2)} {order.currency ?? t("common.currency")}
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">{t("orders.details.fields.cost", { defaultValue: "Cost" })}</p>
                <p className="text-sm font-medium">
                  {typeof order.costStore === "number"
                    ? `${order.costStore.toFixed(2)} ${order.currency ?? t("common.currency")}`
                    : "-"}
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">{t("orders.details.fields.profit", { defaultValue: "Profit" })}</p>
                <p className="text-sm font-medium">
                  {typeof order.profitStore === "number"
                    ? `${order.profitStore.toFixed(2)} ${order.currency ?? t("common.currency")}`
                    : "-"}
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">{t("orders.details.fields.quantity")}</p>
                <p className="text-sm font-medium">{order.quantity}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">{t("orders.details.fields.service")}</p>
                <p className="text-sm font-medium">{order.service_name ?? "-"}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">{t("orders.details.fields.platform")}</p>
                <p className="text-sm font-medium">{order.platform ?? "-"}</p>
              </div>
              <div className="rounded-lg border p-3 sm:col-span-2">
                <p className="text-xs text-muted-foreground">{t("orders.details.fields.link")}</p>
                <p className="text-sm font-medium break-all">{order.link ?? "-"}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">{t("orders.details.fields.createdAt")}</p>
                <p className="text-sm font-medium">{createdAt}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">{t("orders.details.fields.updatedAt")}</p>
                <p className="text-sm font-medium">{updatedAt}</p>
              </div>
            </div>
          </div>

          {isUnrouted && routingReasonEntries.length ? (
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground">{t("orders.details.routing.diagnosticsTitle")}</h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                {routingReasonEntries.map((entry) => (
                  <div key={entry.key} className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">{t(`orders.details.routing.reasons.${entry.key}`, { defaultValue: entry.key })}</p>
                    <p className="text-lg font-semibold">{entry.count}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div>
            <h3 className="text-sm font-semibold text-muted-foreground">{t("orders.details.fulfillments")}</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-4">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">SUCCESS</p>
                <p className="text-lg font-semibold">{order.fulfillments?.success ?? 0}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">FAILED</p>
                <p className="text-lg font-semibold">{order.fulfillments?.failed ?? 0}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">PENDING</p>
                <p className="text-lg font-semibold">{order.fulfillments?.pending ?? 0}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">SUBMITTED</p>
                <p className="text-lg font-semibold">{order.fulfillments?.submitted ?? 0}</p>
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-muted-foreground">{t("orders.details.items")}</h3>
            </div>
            {order.items?.length ? (
              isMobile ? (
                <div className="mt-3 space-y-3">
                  {order.items.map((item) => {
                    const statusText =
                      item.fulfillment_status ??
                      routingReasonLabel(t, item.routing_reason) ??
                      (isUnrouted ? t("orders.details.routing.unrouted") : "PENDING");

                    return (
                      <div key={item.id} className="rounded-lg border p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{item.product_name ?? item.salla_product_id}</p>
                            {item.salla_sku ? <p className="truncate text-xs text-muted-foreground">SKU: {item.salla_sku}</p> : null}
                            {item.product_category ? <p className="truncate text-xs text-muted-foreground">{item.product_category}</p> : null}
                          </div>
                          <Badge variant="secondary" className={fulfillmentColor(item.fulfillment_status)}>
                            {statusText}
                          </Badge>
                        </div>

                        <div className="mt-3 grid gap-2">
                          <div className="flex items-center justify-between gap-3 text-xs">
                            <span className="text-muted-foreground">{t("orders.details.columns.quantity")}</span>
                            <span className="font-medium">{item.quantity}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3 text-xs">
                            <span className="text-muted-foreground">{t("orders.details.columns.cost", { defaultValue: "Cost" })}</span>
                            <span className="font-medium">
                              {typeof item.item_cost_store === "number"
                                ? `${item.item_cost_store.toFixed(2)} ${order.currency ?? t("common.currency")}`
                                : "-"}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-3 text-xs">
                            <span className="text-muted-foreground">{t("orders.details.columns.profit", { defaultValue: "Profit" })}</span>
                            <span className="font-medium">
                              {typeof item.item_profit_store === "number"
                                ? `${item.item_profit_store.toFixed(2)} ${order.currency ?? t("common.currency")}`
                                : "-"}
                            </span>
                          </div>
                          <div className="flex items-start justify-between gap-3 text-xs">
                            <span className="text-muted-foreground">{t("orders.details.columns.target")}</span>
                            <span className="break-all text-right font-medium">{item.target ?? "-"}</span>
                          </div>
                          <div className="flex items-start justify-between gap-3 text-xs">
                            <span className="text-muted-foreground">{t("orders.details.columns.providerOrderId")}</span>
                            <span className="break-all text-right font-medium">{item.provider_order_id ?? "-"}</span>
                          </div>
                          <div className="flex items-start justify-between gap-3 text-xs">
                            <span className="text-muted-foreground">{t("orders.details.columns.lastError")}</span>
                            <span className="break-words text-right text-muted-foreground">{item.last_error ?? "-"}</span>
                          </div>
                        </div>

                        {item.fulfillments?.length ? (
                          <div className="mt-3 space-y-2">
                            <p className="text-xs font-semibold text-muted-foreground">{t("orders.details.fulfillments")}</p>
                            <div className="space-y-1">
                              {item.fulfillments.map((f) => (
                                <div key={f.id} className="flex items-center justify-between gap-2 rounded-md border px-2 py-1 text-xs">
                                  <Badge variant="secondary" className={fulfillmentColor(f.status)}>
                                    {f.status}
                                  </Badge>
                                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{f.provider_order_id ?? "-"}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("orders.details.columns.product")}</TableHead>
                        <TableHead>{t("orders.details.columns.quantity")}</TableHead>
                        <TableHead className="text-right">{t("orders.details.columns.cost", { defaultValue: "Cost" })}</TableHead>
                        <TableHead className="text-right">{t("orders.details.columns.profit", { defaultValue: "Profit" })}</TableHead>
                        <TableHead>{t("orders.details.columns.target")}</TableHead>
                        <TableHead>{t("orders.details.columns.fulfillment")}</TableHead>
                        <TableHead>{t("orders.details.columns.providerOrderId")}</TableHead>
                        <TableHead>{t("orders.details.columns.lastError")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {order.items.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell className="min-w-[180px]">
                            <div className="min-w-0">
                              <p className="truncate">{item.product_name ?? item.salla_product_id}</p>
                              {item.salla_sku ? <p className="truncate text-xs text-muted-foreground">SKU: {item.salla_sku}</p> : null}
                              {item.product_category ? <p className="truncate text-xs text-muted-foreground">{item.product_category}</p> : null}
                            </div>
                          </TableCell>
                          <TableCell>{item.quantity}</TableCell>
                          <TableCell className="text-right">
                            {typeof item.item_cost_store === "number"
                              ? `${item.item_cost_store.toFixed(2)} ${order.currency ?? t("common.currency")}`
                              : "-"}
                          </TableCell>
                          <TableCell className="text-right">
                            {typeof item.item_profit_store === "number"
                              ? `${item.item_profit_store.toFixed(2)} ${order.currency ?? t("common.currency")}`
                              : "-"}
                          </TableCell>
                          <TableCell className="max-w-[220px] truncate">{item.target ?? "-"}</TableCell>
                          <TableCell>
                            <div className="space-y-2">
                              <Badge variant="secondary" className={fulfillmentColor(item.fulfillment_status)}>
                                {item.fulfillment_status ??
                                  routingReasonLabel(t, item.routing_reason) ??
                                  (isUnrouted ? t("orders.details.routing.unrouted") : "PENDING")}
                              </Badge>
                              {item.fulfillments?.length ? (
                                <div className="grid gap-1">
                                  {item.fulfillments.slice(0, 4).map((f) => (
                                    <div key={f.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                                      <Badge variant="secondary" className={fulfillmentColor(f.status)}>
                                        {f.status}
                                      </Badge>
                                      <span className="truncate">{f.provider_order_id ?? "-"}</span>
                                    </div>
                                  ))}
                                  {item.fulfillments.length > 4 ? (
                                    <p className="text-[11px] text-muted-foreground">+{item.fulfillments.length - 4} more</p>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell>{item.provider_order_id ?? "-"}</TableCell>
                          <TableCell className="max-w-[220px] truncate text-xs text-muted-foreground">{item.last_error ?? "-"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">{t("orders.details.emptyItems")}</p>
            )}
          </div>
        </div>

        <div className="flex justify-end">
          <DialogClose asChild>
            <Button variant="outline">{t("common.close")}</Button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}
