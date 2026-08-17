import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { CreditCard, Package, ShoppingBag, TrendingUp, Users2, Server, Link2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useAllOrders, useSellerAnalytics, useSellerProducts, useSellerSmmProviders, useSellerSubscription } from "@/hooks/useApi";
import type { OrderStatus } from "@/types";
import { useAuthStore } from "@/store";

type SellerPlan = "basic" | "plus" | "pro" | "special";
type SubscriptionSettings = {
  plan: SellerPlan;
  status: "active" | "inactive";
  renewAt: string | null;
};

function statusColor(s: OrderStatus) {
  if (s === "completed") return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
  if (s === "failed" || s === "cancelled") return "bg-rose-500/10 text-rose-700 dark:text-rose-400";
  if (s === "in_progress" || s === "approved" || s === "submitted") return "bg-sky-500/10 text-sky-700 dark:text-sky-400";
  return "bg-amber-500/10 text-amber-700 dark:text-amber-400";
}

function planLimit(plan: SellerPlan) {
  if (plan === "plus") return 1250;
  if (plan === "pro") return 2000;
  if (plan === "special") return Infinity;
  return 25;
}

export default function SellerDashboardPage() {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === "ar";
  const { user } = useAuthStore();

  const ordersQuery = useAllOrders({}, 1, 25);
  const providersQuery = useSellerSmmProviders();
  const productsQuery = useSellerProducts();
  const analyticsQuery = useSellerAnalytics(14);
  const subscriptionQuery = useSellerSubscription();

  const orders = ordersQuery.data?.data ?? [];
  const recentOrders = useMemo(() => orders.slice(0, 8), [orders]);
  const analytics = analyticsQuery.data?.data;

  const subscription = subscriptionQuery.data?.subscription;
  const subscriptionUsage = subscriptionQuery.data?.usage;
  const sub: SubscriptionSettings = {
    plan: ((subscription?.plan as SellerPlan | undefined) ?? "basic"),
    status: subscription?.status === "active" ? "active" : "inactive",
    renewAt: subscription?.renewAt ?? null,
  };

  const effectiveLimit =
    subscriptionUsage?.limit === null
      ? Infinity
      : typeof subscriptionUsage?.limit === "number"
        ? subscriptionUsage.limit
        : planLimit(sub.plan);
  const usedOrders = subscriptionUsage?.used ?? orders.length;
  const usage = effectiveLimit === Infinity ? 0 : Math.min(100, Math.round((usedOrders / effectiveLimit) * 100));

  const successRatePct =
    analytics?.kpi.fulfillmentsSuccessRate30d == null ? null : Math.round(analytics.kpi.fulfillmentsSuccessRate30d * 100);
  const kpiFulfillments = analytics?.kpi.fulfillmentsByStatus ?? { PENDING: 0, SUBMITTED: 0, SUCCESS: 0, FAILED: 0 };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("seller.dashboard.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("seller.dashboard.subtitle", { name: user?.name ?? "" })}</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button asChild variant="outline">
            <Link to="/seller/orders">{t("seller.dashboard.actions.orders")}</Link>
          </Button>
          <Button asChild>
            <Link to="/seller/account">{t("seller.dashboard.actions.account")}</Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm font-medium">{t("seller.dashboard.cards.totalOrders")}</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {analyticsQuery.isLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold">{analytics?.kpi.totalOrders ?? 0}</div>
            )}
            <p className="mt-1 text-xs text-muted-foreground">{t("seller.dashboard.cards.totalOrdersHint")}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm font-medium">{t("seller.dashboard.analytics.cards.ordersLast7d")}</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {analyticsQuery.isLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold">{analytics?.kpi.ordersLast7d ?? 0}</div>
            )}
            <p className="mt-1 text-xs text-muted-foreground">{t("seller.dashboard.analytics.cards.ordersLast7dHint")}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm font-medium">{t("seller.dashboard.cards.products")}</CardTitle>
            <ShoppingBag className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {productsQuery.isLoading ? <Skeleton className="h-8 w-20" /> : <div className="text-2xl font-bold">{productsQuery.data?.length ?? 0}</div>}
            <p className="mt-1 text-xs text-muted-foreground">{t("seller.dashboard.cards.productsHint")}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm font-medium">{t("seller.dashboard.cards.providers")}</CardTitle>
            <Server className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {providersQuery.isLoading ? <Skeleton className="h-8 w-20" /> : <div className="text-2xl font-bold">{providersQuery.data?.length ?? 0}</div>}
            <p className="mt-1 text-xs text-muted-foreground">{t("seller.dashboard.cards.providersHint")}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm font-medium">{t("seller.dashboard.analytics.cards.revenueLast30d")}</CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {analyticsQuery.isLoading ? (
              <Skeleton className="h-8 w-28" />
            ) : (
              <div className="text-2xl font-bold">
                {(analytics?.kpi.revenueLast30d ?? 0).toFixed(2)} {t("common.currency")}
              </div>
            )}
            <p className="mt-1 text-xs text-muted-foreground">{t("seller.dashboard.analytics.cards.revenueLast30dHint")}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm font-medium">{t("seller.dashboard.analytics.cards.fulfillmentSuccess")}</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="space-y-2">
            {analyticsQuery.isLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold">{successRatePct == null ? "—" : `${successRatePct}%`}</div>
            )}
            <Progress value={successRatePct ?? 0} />
            <p className="text-xs text-muted-foreground">{t("seller.dashboard.analytics.cards.fulfillmentSuccessHint")}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm font-medium">{t("seller.dashboard.analytics.cards.webhookBacklog")}</CardTitle>
            <Users2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {analyticsQuery.isLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold">{analytics?.webhooks.backlog ?? 0}</div>
            )}
            <p className="mt-1 text-xs text-muted-foreground">{t("seller.dashboard.analytics.cards.webhookBacklogHint")}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm font-medium">{t("seller.dashboard.analytics.cards.routingIssues")}</CardTitle>
            <Link2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {analyticsQuery.isLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold">
                {(analytics?.routing.unmappedItemsLast30d ?? 0) + (analytics?.routing.mappedNoRuleItemsLast30d ?? 0)}
              </div>
            )}
            <p className="mt-1 text-xs text-muted-foreground">{t("seller.dashboard.analytics.cards.routingIssuesHint")}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" /> {t("seller.dashboard.subscription.title")}
            </CardTitle>
            <CardDescription>{t("seller.dashboard.subscription.subtitle")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">{t("seller.dashboard.subscription.plan")}</p>
                <p className="text-sm font-medium">{t(`seller.account.plans.${sub.plan}`)}</p>
              </div>
              <Badge
                variant="secondary"
                className={
                  sub.status === "active"
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                    : "bg-rose-500/10 text-rose-700 dark:text-rose-400"
                }
              >
                {sub.status === "active" ? t("seller.account.status.active") : t("seller.account.status.inactive")}
              </Badge>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{t("seller.dashboard.subscription.usage")}</span>
                <span className="font-medium text-foreground">
                  {usedOrders}/{effectiveLimit === Infinity ? "∞" : effectiveLimit}
                </span>
              </div>
              <Progress value={usage} />
              <p className="text-xs text-muted-foreground">{t("seller.dashboard.subscription.usageHint")}</p>
            </div>

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{t("seller.dashboard.subscription.renewAt")}</span>
              <span className="text-foreground">{sub.renewAt ? new Date(sub.renewAt).toLocaleDateString() : "—"}</span>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button asChild variant="outline">
                <Link to="/seller/account">{t("seller.dashboard.subscription.manage")}</Link>
              </Button>
              <Button asChild>
                <Link to="/auth/register">{t("seller.dashboard.subscription.upgrade")}</Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users2 className="h-5 w-5" /> {t("seller.dashboard.recent.title")}
            </CardTitle>
            <CardDescription>{t("seller.dashboard.recent.subtitle")}</CardDescription>
          </CardHeader>
          <CardContent>
            {ordersQuery.isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : recentOrders.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("seller.dashboard.recent.empty")}</p>
            ) : (
              <div className={cn("overflow-x-auto", isRTL && "[direction:rtl]")}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("seller.dashboard.recent.columns.id")}</TableHead>
                      <TableHead className="hidden md:table-cell">{t("seller.dashboard.recent.columns.createdAt")}</TableHead>
                      <TableHead>{t("seller.dashboard.recent.columns.status")}</TableHead>
                      <TableHead className="text-right">{t("seller.dashboard.recent.columns.total")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentOrders.map((o) => (
                      <TableRow key={o.id}>
                        <TableCell className="font-medium">{o.id}</TableCell>
                        <TableCell className="hidden md:table-cell">{new Date(o.createdAt).toLocaleString()}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className={statusColor(o.status)}>
                            {o.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {o.totalPrice.toFixed(2)} {t("common.currency")}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {!ordersQuery.isLoading && (
              <div className="mt-4 flex justify-end">
                <Button asChild variant="outline">
                  <Link to="/seller/orders">{t("seller.dashboard.recent.viewAll")}</Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t("seller.dashboard.analytics.ordersByDayTitle")}</CardTitle>
            <CardDescription>{t("seller.dashboard.analytics.ordersByDayHint")}</CardDescription>
          </CardHeader>
          <CardContent>
            {analyticsQuery.isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : !analytics?.ordersByDay?.length ? (
              <p className="text-sm text-muted-foreground">{t("seller.dashboard.analytics.empty")}</p>
            ) : (
              <div className={cn("overflow-x-auto", isRTL && "[direction:rtl]")}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("seller.dashboard.analytics.columns.day")}</TableHead>
                      <TableHead>{t("seller.dashboard.analytics.columns.orders")}</TableHead>
                      <TableHead className="text-right">{t("seller.dashboard.analytics.columns.revenue")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {analytics.ordersByDay.map((r) => (
                      <TableRow key={r.day}>
                        <TableCell className="font-medium">{r.day}</TableCell>
                        <TableCell>{r.orders}</TableCell>
                        <TableCell className="text-right">
                          {r.revenue.toFixed(2)} {t("common.currency")}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>{t("seller.dashboard.analytics.fulfillmentsTitle")}</CardTitle>
            <CardDescription>{t("seller.dashboard.analytics.fulfillmentsHint")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {analyticsQuery.isLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : (
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{t("seller.dashboard.analytics.fulfillmentStatus.pending")}</span>
                  <span className="font-medium">{kpiFulfillments.PENDING}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{t("seller.dashboard.analytics.fulfillmentStatus.submitted")}</span>
                  <span className="font-medium">{kpiFulfillments.SUBMITTED}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{t("seller.dashboard.analytics.fulfillmentStatus.success")}</span>
                  <span className="font-medium">{kpiFulfillments.SUCCESS}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{t("seller.dashboard.analytics.fulfillmentStatus.failed")}</span>
                  <span className="font-medium">{kpiFulfillments.FAILED}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("seller.dashboard.analytics.topProductsTitle")}</CardTitle>
            <CardDescription>{t("seller.dashboard.analytics.topProductsHint")}</CardDescription>
          </CardHeader>
          <CardContent>
            {analyticsQuery.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : !analytics?.topProducts?.length ? (
              <p className="text-sm text-muted-foreground">{t("seller.dashboard.analytics.empty")}</p>
            ) : (
              <div className={cn("overflow-x-auto", isRTL && "[direction:rtl]")}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("seller.dashboard.analytics.columns.product")}</TableHead>
                      <TableHead className="text-right">{t("seller.dashboard.analytics.columns.items")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {analytics.topProducts.map((p) => (
                      <TableRow key={p.salla_product_id}>
                        <TableCell className="font-medium">{p.name}</TableCell>
                        <TableCell className="text-right">{p.c}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("seller.dashboard.analytics.topProvidersTitle")}</CardTitle>
            <CardDescription>{t("seller.dashboard.analytics.topProvidersHint")}</CardDescription>
          </CardHeader>
          <CardContent>
            {analyticsQuery.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : !analytics?.topProviders?.length ? (
              <p className="text-sm text-muted-foreground">{t("seller.dashboard.analytics.empty")}</p>
            ) : (
              <div className={cn("overflow-x-auto", isRTL && "[direction:rtl]")}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("seller.dashboard.analytics.columns.provider")}</TableHead>
                      <TableHead className="text-right">{t("seller.dashboard.analytics.columns.total")}</TableHead>
                      <TableHead className="text-right">{t("seller.dashboard.analytics.columns.failed")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {analytics.topProviders.map((p) => (
                      <TableRow key={p.provider_id}>
                        <TableCell className="font-medium">{p.name}</TableCell>
                        <TableCell className="text-right">{p.total}</TableCell>
                        <TableCell className="text-right">
                          <Badge variant="secondary" className={p.failed > 0 ? "bg-rose-500/10 text-rose-700 dark:text-rose-400" : ""}>
                            {p.failed}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm font-medium">{t("seller.dashboard.cards.completedOrders")}</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {analyticsQuery.isLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold">{kpiFulfillments.SUCCESS}</div>
            )}
            <p className="mt-1 text-xs text-muted-foreground">{t("seller.dashboard.cards.completedOrdersHint")}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm font-medium">{t("seller.dashboard.analytics.cards.pendingFulfillments")}</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {analyticsQuery.isLoading ? <Skeleton className="h-8 w-28" /> : <div className="text-2xl font-bold">{kpiFulfillments.PENDING + kpiFulfillments.SUBMITTED}</div>}
            <p className="mt-1 text-xs text-muted-foreground">{t("seller.dashboard.analytics.cards.pendingFulfillmentsHint")}</p>
          </CardContent>
        </Card>

        <Card className="sm:col-span-2 lg:col-span-1">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm font-medium">{t("seller.dashboard.cards.help")}</CardTitle>
            <Users2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">{t("seller.dashboard.cards.helpHint")}</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button asChild variant="outline" className="w-full">
                <Link to="/seller/smm-providers">{t("seller.dashboard.cards.goProviders")}</Link>
              </Button>
              <Button asChild className="w-full">
                <Link to="/seller/products">{t("seller.dashboard.cards.goProducts")}</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
