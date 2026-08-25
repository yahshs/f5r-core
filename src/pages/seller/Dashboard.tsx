import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  CreditCard,
  Package,
  Server,
  ShoppingBag,
  TriangleAlert,
  Zap,
  type LucideIcon,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  useAllOrders,
  useSellerAnalytics,
  useSellerProducts,
  useSellerSmmProviders,
  useSellerSubscription,
} from '@/hooks/useApi';
import type { OrderStatus } from '@/types';
import { useAuthStore } from '@/store';

type SellerPlan = 'basic' | 'plus' | 'pro' | 'special';

type MetricCardProps = {
  label: string;
  value: string | number;
  hint: string;
  icon: LucideIcon;
  loading?: boolean;
  tone?: 'gold' | 'green' | 'blue' | 'rose';
};

const metricTone = {
  gold: 'bg-primary/12 text-primary',
  green: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  blue: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  rose: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
};

function MetricCard({ label, value, hint, icon: Icon, loading, tone = 'gold' }: MetricCardProps) {
  return (
    <Card className="overflow-hidden rounded-2xl border-border/70 bg-card/90 shadow-sm">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-muted-foreground sm:text-sm">{label}</p>
            {loading ? <Skeleton className="mt-3 h-8 w-20" /> : <p className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">{value}</p>}
          </div>
          <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl sm:h-11 sm:w-11', metricTone[tone])}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
        <p className="mt-3 line-clamp-1 text-[11px] text-muted-foreground sm:text-xs">{hint}</p>
      </CardContent>
    </Card>
  );
}

function statusColor(status: OrderStatus) {
  if (status === 'completed') return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400';
  if (status === 'failed' || status === 'cancelled') return 'border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-400';
  if (status === 'in_progress' || status === 'approved' || status === 'submitted') {
    return 'border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-400';
  }
  return 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400';
}

function planLimit(plan: SellerPlan) {
  if (plan === 'plus') return 1250;
  if (plan === 'pro') return 2000;
  if (plan === 'special') return Infinity;
  return 25;
}

export default function SellerDashboardPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuthStore();
  const isRTL = i18n.dir() === 'rtl';
  const locale = isRTL ? 'ar-SA' : 'en-US';
  const ForwardArrow = isRTL ? ArrowLeft : ArrowRight;

  const ordersQuery = useAllOrders({}, 1, 12);
  const providersQuery = useSellerSmmProviders();
  const productsQuery = useSellerProducts();
  const analyticsQuery = useSellerAnalytics(14);
  const subscriptionQuery = useSellerSubscription();

  const recentOrders = (ordersQuery.data?.data ?? []).slice(0, 6);
  const analytics = analyticsQuery.data?.data;
  const fulfillment = analytics?.kpi.fulfillmentsByStatus ?? { PENDING: 0, SUBMITTED: 0, SUCCESS: 0, FAILED: 0 };
  const activeFulfillments = fulfillment.PENDING + fulfillment.SUBMITTED;
  const routingIssues = (analytics?.routing.unmappedItemsLast30d ?? 0) + (analytics?.routing.mappedNoRuleItemsLast30d ?? 0);
  const successRate = analytics?.kpi.fulfillmentsSuccessRate30d == null
    ? null
    : Math.round(analytics.kpi.fulfillmentsSuccessRate30d * 100);

  const subscription = subscriptionQuery.data?.subscription;
  const subscriptionUsage = subscriptionQuery.data?.usage;
  const plan = (subscription?.plan as SellerPlan | undefined) ?? 'basic';
  const effectiveLimit = subscriptionUsage?.limit === null
    ? Infinity
    : typeof subscriptionUsage?.limit === 'number'
      ? subscriptionUsage.limit
      : planLimit(plan);
  const usedOrders = subscriptionUsage?.used ?? 0;
  const usagePercent = effectiveLimit === Infinity ? 0 : Math.min(100, Math.round((usedOrders / Math.max(1, effectiveLimit)) * 100));

  const copy = isRTL
    ? {
        overview: 'نظرة واضحة على الطلبات والتنفيذ من مكان واحد.',
        live: 'محدّث تلقائياً',
        active: 'قيد التنفيذ',
        activeHint: 'معلّق + مُرسل للمزوّد',
        performance: 'أداء التنفيذ',
        performanceHint: 'ملخص حالة التنفيذ خلال آخر 30 يوم.',
        successRate: 'نسبة النجاح',
        setup: 'جاهزية المتجر',
        setupHint: 'حالة الربط والتوجيه الحالية.',
        webhookQueue: 'انتظار الويب هوك',
        routingIssues: 'تحتاج ضبط توجيه',
        healthy: 'كل شيء جاهز',
        needsAttention: 'تحتاج مراجعة',
        subscriptionUsage: 'استخدام الباقة',
        of: 'من',
      }
    : {
        overview: 'A clear view of orders and fulfillment in one place.',
        live: 'Updates automatically',
        active: 'In progress',
        activeHint: 'Pending + submitted to provider',
        performance: 'Fulfillment performance',
        performanceHint: 'Execution status over the last 30 days.',
        successRate: 'Success rate',
        setup: 'Store readiness',
        setupHint: 'Current connection and routing health.',
        webhookQueue: 'Webhook queue',
        routingIssues: 'Routing needs setup',
        healthy: 'Everything is ready',
        needsAttention: 'Needs attention',
        subscriptionUsage: 'Plan usage',
        of: 'of',
      };

  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const money = (value: number) => new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  const date = (value: string) => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
  const statusLabel = (status: OrderStatus) => t(`orders.status.${status}`, { defaultValue: status });

  return (
    <div className="space-y-5 sm:space-y-6">
      <section className="relative overflow-hidden rounded-3xl border border-primary/15 bg-card px-4 py-5 shadow-sm sm:px-6 sm:py-6">
        <div className="pointer-events-none absolute -end-16 -top-20 h-48 w-48 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              <span>{copy.live}</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{t('seller.dashboard.subtitle', { name: user?.name ?? '' })}</h1>
            <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{copy.overview}</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:w-auto">
            <Button asChild variant="outline" className="min-w-0 rounded-xl bg-background/80">
              <Link to="/seller/account">{t('seller.dashboard.actions.account')}</Link>
            </Button>
            <Button asChild className="min-w-0 gap-2 rounded-xl btn-primary">
              <Link to="/seller/orders">
                {t('seller.dashboard.actions.orders')}
                <ForwardArrow className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MetricCard
          label={t('seller.dashboard.cards.totalOrders')}
          value={number(analytics?.kpi.totalOrders ?? 0)}
          hint={t('seller.dashboard.cards.totalOrdersHint')}
          icon={Package}
          loading={analyticsQuery.isLoading}
        />
        <MetricCard
          label={t('seller.dashboard.cards.completedOrders')}
          value={number(fulfillment.SUCCESS)}
          hint={t('seller.dashboard.cards.completedOrdersHint')}
          icon={CheckCircle2}
          loading={analyticsQuery.isLoading}
          tone="green"
        />
        <MetricCard
          label={copy.active}
          value={number(activeFulfillments)}
          hint={copy.activeHint}
          icon={Clock3}
          loading={analyticsQuery.isLoading}
          tone="blue"
        />
        <MetricCard
          label={t('seller.dashboard.analytics.cards.revenueLast30d')}
          value={`${money(analytics?.kpi.revenueLast30d ?? 0)} ${t('common.currency')}`}
          hint={t('seller.dashboard.analytics.cards.revenueLast30dHint')}
          icon={CircleDollarSign}
          loading={analyticsQuery.isLoading}
        />
      </section>

      <section className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,0.75fr)]">
        <Card className="min-w-0 overflow-hidden rounded-2xl border-border/70 bg-card/90 shadow-sm">
          <CardHeader className="flex-row items-start justify-between gap-3 border-b border-border/60 p-4 sm:p-5">
            <div className="min-w-0">
              <CardTitle className="text-base sm:text-lg">{t('seller.dashboard.recent.title')}</CardTitle>
              <CardDescription className="mt-1">{t('seller.dashboard.recent.subtitle')}</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm" className="shrink-0 gap-1.5 text-primary hover:bg-primary/10 hover:text-primary">
              <Link to="/seller/orders">
                {t('seller.dashboard.recent.viewAll')}
                <ForwardArrow className="h-4 w-4" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {ordersQuery.isLoading ? (
              <div className="space-y-3 p-4 sm:p-5">
                {[0, 1, 2, 3].map((row) => <Skeleton key={row} className="h-16 w-full rounded-xl" />)}
              </div>
            ) : recentOrders.length === 0 ? (
              <div className="flex min-h-64 flex-col items-center justify-center px-5 py-10 text-center">
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Package className="h-6 w-6" />
                </div>
                <p className="font-medium">{t('seller.dashboard.recent.empty')}</p>
                <Button asChild variant="outline" size="sm" className="mt-4 rounded-xl">
                  <Link to="/seller/salla">{t('seller.nav.salla')}</Link>
                </Button>
              </div>
            ) : (
              <div>
                <div className="hidden grid-cols-[minmax(130px,0.85fr)_minmax(160px,1.3fr)_minmax(100px,0.75fr)_minmax(100px,0.65fr)] gap-3 border-b bg-muted/30 px-5 py-3 text-xs font-medium text-muted-foreground sm:grid">
                  <span>{t('seller.dashboard.recent.columns.id')}</span>
                  <span>{t('orders.columns.service')}</span>
                  <span>{t('seller.dashboard.recent.columns.status')}</span>
                  <span className="text-end">{t('seller.dashboard.recent.columns.total')}</span>
                </div>
                <div className="divide-y divide-border/60">
                  {recentOrders.map((order) => (
                    <div
                      key={order.internal_id ?? order.id}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-4 transition-colors hover:bg-primary/[0.035] sm:grid-cols-[minmax(130px,0.85fr)_minmax(160px,1.3fr)_minmax(100px,0.75fr)_minmax(100px,0.65fr)] sm:px-5"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-semibold tabular-nums">#{order.salla_order_id ?? order.id}</p>
                        <p className="mt-1 truncate text-[11px] text-muted-foreground">{date(order.created_at)}</p>
                        <p className="mt-1 truncate text-xs text-muted-foreground sm:hidden">{order.service_name ?? '—'}</p>
                      </div>
                      <div className="hidden min-w-0 sm:block">
                        <p className="truncate text-sm font-medium">{order.service_name ?? '—'}</p>
                        {order.link ? <p className="mt-1 truncate text-xs text-muted-foreground">{order.link}</p> : null}
                      </div>
                      <div className="flex flex-col items-end gap-1.5 sm:items-start">
                        <Badge variant="outline" className={cn('whitespace-nowrap rounded-lg font-medium', statusColor(order.status))}>
                          {statusLabel(order.status)}
                        </Badge>
                        <span className="text-xs font-semibold sm:hidden">
                          {money(Number(order.totalPrice ?? 0))} {order.currency ?? t('common.currency')}
                        </span>
                      </div>
                      <p className="hidden text-end text-sm font-semibold tabular-nums sm:block">
                        {money(Number(order.totalPrice ?? 0))} <span className="text-xs text-muted-foreground">{order.currency ?? t('common.currency')}</span>
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-1">
          <Card className="rounded-2xl border-border/70 bg-card/90 shadow-sm">
            <CardHeader className="p-4 pb-3 sm:p-5 sm:pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Zap className="h-5 w-5 text-primary" />
                {copy.performance}
              </CardTitle>
              <CardDescription>{copy.performanceHint}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 p-4 pt-1 sm:p-5 sm:pt-1">
              <div className="rounded-xl border border-primary/15 bg-primary/[0.055] p-3.5">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="text-sm text-muted-foreground">{copy.successRate}</span>
                  <span className="text-xl font-bold text-primary">{successRate == null ? '—' : `${number(successRate)}%`}</span>
                </div>
                <Progress value={successRate ?? 0} className="h-2" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-emerald-500/[0.07] p-3">
                  <p className="text-xs text-muted-foreground">{t('seller.dashboard.analytics.fulfillmentStatus.success')}</p>
                  <p className="mt-1 text-lg font-bold text-emerald-600 dark:text-emerald-400">{number(fulfillment.SUCCESS)}</p>
                </div>
                <div className="rounded-xl bg-rose-500/[0.07] p-3">
                  <p className="text-xs text-muted-foreground">{t('seller.dashboard.analytics.fulfillmentStatus.failed')}</p>
                  <p className="mt-1 text-lg font-bold text-rose-600 dark:text-rose-400">{number(fulfillment.FAILED)}</p>
                </div>
                <div className="rounded-xl bg-amber-500/[0.07] p-3">
                  <p className="text-xs text-muted-foreground">{t('seller.dashboard.analytics.fulfillmentStatus.pending')}</p>
                  <p className="mt-1 text-lg font-bold text-amber-600 dark:text-amber-400">{number(fulfillment.PENDING)}</p>
                </div>
                <div className="rounded-xl bg-sky-500/[0.07] p-3">
                  <p className="text-xs text-muted-foreground">{t('seller.dashboard.analytics.fulfillmentStatus.submitted')}</p>
                  <p className="mt-1 text-lg font-bold text-sky-600 dark:text-sky-400">{number(fulfillment.SUBMITTED)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-border/70 bg-card/90 shadow-sm">
            <CardHeader className="p-4 pb-3 sm:p-5 sm:pb-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">{copy.setup}</CardTitle>
                  <CardDescription className="mt-1">{copy.setupHint}</CardDescription>
                </div>
                <Badge
                  variant="outline"
                  className={cn(
                    'shrink-0 rounded-lg',
                    routingIssues === 0 && (analytics?.webhooks.backlog ?? 0) === 0
                      ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                      : 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400',
                  )}
                >
                  {routingIssues === 0 && (analytics?.webhooks.backlog ?? 0) === 0 ? copy.healthy : copy.needsAttention}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 p-4 pt-1 sm:p-5 sm:pt-1">
              <Link to="/seller/products" className="flex items-center justify-between rounded-xl px-3 py-2.5 transition-colors hover:bg-primary/[0.06]">
                <span className="flex items-center gap-2 text-sm text-muted-foreground"><ShoppingBag className="h-4 w-4 text-primary" />{t('seller.dashboard.cards.products')}</span>
                {productsQuery.isLoading ? <Skeleton className="h-5 w-8" /> : <strong>{number(productsQuery.data?.length ?? 0)}</strong>}
              </Link>
              <Link to="/seller/smm-providers" className="flex items-center justify-between rounded-xl px-3 py-2.5 transition-colors hover:bg-primary/[0.06]">
                <span className="flex items-center gap-2 text-sm text-muted-foreground"><Server className="h-4 w-4 text-primary" />{t('seller.dashboard.cards.providers')}</span>
                {providersQuery.isLoading ? <Skeleton className="h-5 w-8" /> : <strong>{number(providersQuery.data?.length ?? 0)}</strong>}
              </Link>
              <div className="flex items-center justify-between rounded-xl px-3 py-2.5">
                <span className="flex items-center gap-2 text-sm text-muted-foreground"><Clock3 className="h-4 w-4 text-primary" />{copy.webhookQueue}</span>
                <strong>{number(analytics?.webhooks.backlog ?? 0)}</strong>
              </div>
              <div className="flex items-center justify-between rounded-xl px-3 py-2.5">
                <span className="flex items-center gap-2 text-sm text-muted-foreground"><TriangleAlert className="h-4 w-4 text-primary" />{copy.routingIssues}</span>
                <strong>{number(routingIssues)}</strong>
              </div>

              <div className="mt-3 border-t border-border/60 pt-4">
                <div className="mb-2 flex items-center justify-between gap-3 text-xs">
                  <span className="flex items-center gap-2 text-muted-foreground"><CreditCard className="h-4 w-4 text-primary" />{copy.subscriptionUsage}</span>
                  <span className="font-semibold">
                    {number(usedOrders)} {copy.of} {effectiveLimit === Infinity ? '∞' : number(effectiveLimit)}
                  </span>
                </div>
                <Progress value={usagePercent} className="h-1.5" />
                <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                  <span>{t(`seller.account.plans.${plan}`)}</span>
                  <Link to="/seller/account" className="font-medium text-primary hover:underline">{t('seller.dashboard.subscription.manage')}</Link>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
