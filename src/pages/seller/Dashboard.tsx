import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  CreditCard,
  Link2,
  Package,
  Radio,
  Server,
  ShoppingBag,
  TriangleAlert,
  Webhook,
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
  tone?: 'gold' | 'green' | 'teal' | 'rose';
};

const metricTone = {
  gold: 'bg-primary/[0.1] text-primary',
  green: 'bg-emerald-400/[0.09] text-emerald-400',
  teal: 'bg-teal-400/[0.09] text-teal-300',
  rose: 'bg-rose-400/[0.09] text-rose-400',
};

function MetricCard({ label, value, hint, icon: Icon, loading, tone = 'gold' }: MetricCardProps) {
  return (
    <Card className="f5r-glass-panel group relative overflow-hidden rounded-[20px]">
      <div className="pointer-events-none absolute -end-10 -top-12 h-24 w-24 rounded-full bg-primary/[0.055] blur-2xl transition-colors group-hover:bg-primary/[0.09]" />
      <CardContent className="relative p-4 sm:p-[18px]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-muted-foreground sm:text-sm">{label}</p>
            {loading ? (
              <Skeleton className="mt-3 h-8 w-24" />
            ) : (
              <p className="mt-2 truncate text-2xl font-bold tracking-tight sm:text-[28px]">{value}</p>
            )}
          </div>
          <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', metricTone[tone])}>
            <Icon className="h-[18px] w-[18px]" />
          </div>
        </div>
        <p className="mt-3 line-clamp-1 text-[11px] text-muted-foreground sm:text-xs">{hint}</p>
      </CardContent>
    </Card>
  );
}

function statusColor(status: OrderStatus) {
  if (status === 'completed') return 'border-emerald-400/15 bg-emerald-400/[0.09] text-emerald-300';
  if (status === 'failed' || status === 'cancelled') return 'border-rose-400/15 bg-rose-400/[0.09] text-rose-300';
  if (status === 'in_progress' || status === 'approved' || status === 'submitted') {
    return 'border-teal-400/15 bg-teal-400/[0.09] text-teal-200';
  }
  return 'border-primary/15 bg-primary/[0.09] text-primary';
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

  const recentOrders = (ordersQuery.data?.data ?? []).slice(0, 5);
  const analytics = analyticsQuery.data?.data;
  const fulfillment = analytics?.kpi.fulfillmentsByStatus ?? { PENDING: 0, SUBMITTED: 0, SUCCESS: 0, FAILED: 0 };
  const activeFulfillments = fulfillment.PENDING + fulfillment.SUBMITTED;
  const routingIssues = (analytics?.routing.unmappedItemsLast30d ?? 0) + (analytics?.routing.mappedNoRuleItemsLast30d ?? 0);
  const webhookBacklog = analytics?.webhooks.backlog ?? 0;
  const successRate = analytics?.kpi.fulfillmentsSuccessRate30d == null
    ? null
    : Math.round(analytics.kpi.fulfillmentsSuccessRate30d * 100);
  const readinessHealthy = routingIssues === 0 && webhookBacklog === 0;

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
        subtitle: 'هذه نظرة مباشرة على تشغيل متجرك.',
        sync: 'مزامنة لحظية مع سلة',
        heroTitle: 'واجهة هادئة، وتشغيل واضح لحظة بلحظة.',
        heroDescription: 'الطلبات والتنفيذ والتعويضات في مكان واحد، بتفاصيل كافية بدون ازدحام.',
        followOrders: 'متابعة الطلبات',
        manageConnection: 'إدارة الربط',
        efficiency: 'كفاءة التنفيذ',
        last30Days: 'آخر 30 يومًا',
        active: 'قيد التنفيذ',
        activeHint: 'معلّق + مُرسل للمزوّد',
        performance: 'حركة التنفيذ',
        performanceHint: 'توزيع حالة الطلبات عند المزود.',
        setup: 'جاهزية النظام',
        setupHint: 'حالة الربط والتوجيه الحالية.',
        webhookQueue: 'استقبال الفواتير',
        routingIssues: 'تحتاج ضبط توجيه',
        healthy: 'متصل بالكامل',
        needsAttention: 'تحتاج مراجعة',
        subscriptionUsage: 'استخدام الاشتراك',
        compensationBot: 'بوت التعويضات',
        of: 'من',
      }
    : {
        subtitle: 'A live view of your store operation.',
        sync: 'Live sync with Salla',
        heroTitle: 'A calm interface with a clear real-time operation.',
        heroDescription: 'Orders, fulfillment, and compensation in one focused workspace.',
        followOrders: 'View orders',
        manageConnection: 'Manage connection',
        efficiency: 'Fulfillment efficiency',
        last30Days: 'Last 30 days',
        active: 'In progress',
        activeHint: 'Pending + submitted to provider',
        performance: 'Fulfillment flow',
        performanceHint: 'Current provider fulfillment distribution.',
        setup: 'System readiness',
        setupHint: 'Current connection and routing health.',
        webhookQueue: 'Invoice ingestion',
        routingIssues: 'Routing needs setup',
        healthy: 'Fully connected',
        needsAttention: 'Needs attention',
        subscriptionUsage: 'Subscription usage',
        compensationBot: 'Compensation bot',
        of: 'of',
      };

  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const money = (value: number) => new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  const date = (value: string) => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
  const statusLabel = (status: OrderStatus) => t(`orders.status.${status}`, { defaultValue: status });
  const ringValue = successRate ?? 0;

  return (
    <div className="space-y-4 sm:space-y-5">
      <header className="flex items-center justify-between gap-4 px-1">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold tracking-tight sm:text-2xl">
            {t('seller.dashboard.subtitle', { name: user?.name ?? '' })}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground sm:text-sm">{copy.subtitle}</p>
        </div>
        <div className="hidden items-center gap-2 sm:flex">
          <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_0_4px_rgba(52,211,153,0.09)]" />
          <span className="text-xs text-muted-foreground">{copy.healthy}</span>
        </div>
      </header>

      <section className="grid gap-3 xl:grid-cols-[minmax(0,1.55fr)_minmax(230px,0.55fr)]">
        <div className="f5r-glass-panel f5r-gold-panel relative min-h-[190px] overflow-hidden rounded-[24px] p-5 sm:p-6">
          <div className="pointer-events-none absolute -bottom-28 -start-20 h-56 w-56 rounded-full border-[30px] border-primary/[0.055]" />
          <div className="relative z-10">
            <div className="flex items-center gap-2 text-xs font-medium text-teal-300">
              <Radio className="h-4 w-4" />
              <span>{copy.sync}</span>
            </div>
            <h2 className="mt-4 max-w-2xl text-2xl font-bold tracking-tight sm:text-3xl">{copy.heroTitle}</h2>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{copy.heroDescription}</p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button asChild className="gap-2 rounded-xl btn-primary">
                <Link to="/seller/orders">
                  <Package className="h-4 w-4" />
                  {copy.followOrders}
                  <ForwardArrow className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" className="gap-2 rounded-xl border-white/10 bg-white/[0.025] hover:bg-white/[0.06]">
                <Link to="/seller/salla">
                  <Link2 className="h-4 w-4 text-primary" />
                  {copy.manageConnection}
                </Link>
              </Button>
            </div>
          </div>
        </div>

        <Card className="f5r-glass-panel flex min-h-[190px] items-center justify-center rounded-[24px]">
          <CardContent className="flex w-full items-center justify-center gap-5 p-5 text-center xl:flex-col xl:gap-3">
            {analyticsQuery.isLoading ? (
              <Skeleton className="h-28 w-28 rounded-full" />
            ) : (
              <div
                className="relative grid h-28 w-28 shrink-0 place-items-center rounded-full p-[7px]"
                style={{ background: `conic-gradient(hsl(var(--primary)) ${ringValue}%, hsl(var(--muted)) ${ringValue}% 100%)` }}
                role="img"
                aria-label={`${copy.efficiency}: ${successRate == null ? '—' : `${successRate}%`}`}
              >
                <div className="grid h-full w-full place-items-center rounded-full border border-white/[0.045] bg-card shadow-[inset_0_0_28px_rgba(0,0,0,0.22)]">
                  <span className="text-2xl font-bold text-primary">{successRate == null ? '—' : `${number(successRate)}%`}</span>
                </div>
              </div>
            )}
            <div>
              <p className="font-semibold">{copy.efficiency}</p>
              <p className="mt-1 text-xs text-muted-foreground">{copy.last30Days}</p>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MetricCard label={t('seller.dashboard.cards.totalOrders')} value={number(analytics?.kpi.totalOrders ?? 0)} hint={t('seller.dashboard.cards.totalOrdersHint')} icon={Package} loading={analyticsQuery.isLoading} />
        <MetricCard label={t('seller.dashboard.cards.completedOrders')} value={number(fulfillment.SUCCESS)} hint={t('seller.dashboard.cards.completedOrdersHint')} icon={CheckCircle2} loading={analyticsQuery.isLoading} tone="green" />
        <MetricCard label={copy.active} value={number(activeFulfillments)} hint={copy.activeHint} icon={Clock3} loading={analyticsQuery.isLoading} tone="teal" />
        <MetricCard label={t('seller.dashboard.analytics.cards.revenueLast30d')} value={`${money(analytics?.kpi.revenueLast30d ?? 0)} ${t('common.currency')}`} hint={t('seller.dashboard.analytics.cards.revenueLast30dHint')} icon={CircleDollarSign} loading={analyticsQuery.isLoading} />
      </section>

      <section className="grid items-start gap-3 xl:grid-cols-[minmax(0,1.58fr)_minmax(300px,0.62fr)]">
        <Card className="f5r-glass-panel min-w-0 overflow-hidden rounded-[22px]">
          <CardHeader className="flex-row items-start justify-between gap-3 border-b border-white/[0.065] p-4 sm:p-5">
            <div className="min-w-0"><CardTitle className="text-base sm:text-lg">{t('seller.dashboard.recent.title')}</CardTitle><CardDescription className="mt-1">{t('seller.dashboard.recent.subtitle')}</CardDescription></div>
            <Button asChild variant="ghost" size="sm" className="shrink-0 gap-1.5 rounded-xl text-primary hover:bg-primary/10 hover:text-primary"><Link to="/seller/orders">{t('seller.dashboard.recent.viewAll')}<ForwardArrow className="h-4 w-4" /></Link></Button>
          </CardHeader>
          <CardContent className="p-0">
            {ordersQuery.isLoading ? (
              <div className="space-y-3 p-4 sm:p-5">{[0, 1, 2, 3].map((row) => <Skeleton key={row} className="h-14 w-full rounded-xl" />)}</div>
            ) : recentOrders.length === 0 ? (
              <div className="flex min-h-64 flex-col items-center justify-center px-5 py-10 text-center"><div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Package className="h-6 w-6" /></div><p className="font-medium">{t('seller.dashboard.recent.empty')}</p><Button asChild variant="outline" size="sm" className="mt-4 rounded-xl"><Link to="/seller/salla">{t('seller.nav.salla')}</Link></Button></div>
            ) : (
              <div>
                <div className="hidden grid-cols-[minmax(110px,0.75fr)_minmax(160px,1.35fr)_minmax(100px,0.7fr)_minmax(90px,0.6fr)] gap-3 border-b border-white/[0.055] bg-black/[0.08] px-5 py-3 text-xs font-medium text-muted-foreground sm:grid"><span>{t('seller.dashboard.recent.columns.id')}</span><span>{t('orders.columns.service')}</span><span>{t('seller.dashboard.recent.columns.status')}</span><span className="text-end">{t('seller.dashboard.recent.columns.total')}</span></div>
                <div className="divide-y divide-white/[0.055]">
                  {recentOrders.map((order) => (
                    <div key={order.internal_id ?? order.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3.5 transition-colors hover:bg-primary/[0.025] sm:grid-cols-[minmax(110px,0.75fr)_minmax(160px,1.35fr)_minmax(100px,0.7fr)_minmax(90px,0.6fr)] sm:px-5">
                      <div className="min-w-0"><p className="truncate font-semibold tabular-nums">#{order.salla_order_id ?? order.id}</p><p className="mt-1 truncate text-[11px] text-muted-foreground">{date(order.created_at)}</p><p className="mt-1 truncate text-xs text-muted-foreground sm:hidden">{order.service_name ?? '—'}</p></div>
                      <div className="hidden min-w-0 sm:block"><p className="truncate text-sm font-medium">{order.service_name ?? '—'}</p>{order.link ? <p className="mt-1 truncate text-xs text-muted-foreground">{order.link}</p> : null}</div>
                      <div className="flex flex-col items-end gap-1.5 sm:items-start"><Badge variant="outline" className={cn('whitespace-nowrap rounded-lg font-medium', statusColor(order.status))}>{statusLabel(order.status)}</Badge><span className="text-xs font-semibold sm:hidden">{money(Number(order.totalPrice ?? 0))} {order.currency ?? t('common.currency')}</span></div>
                      <p className="hidden text-end text-sm font-semibold tabular-nums sm:block">{money(Number(order.totalPrice ?? 0))} <span className="text-xs text-muted-foreground">{order.currency ?? t('common.currency')}</span></p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
          <Card className="f5r-glass-panel rounded-[22px]">
            <CardHeader className="p-4 pb-3 sm:p-5 sm:pb-3"><CardTitle className="flex items-center gap-2 text-base"><Zap className="h-5 w-5 text-primary" />{copy.performance}</CardTitle><CardDescription>{copy.performanceHint}</CardDescription></CardHeader>
            <CardContent className="grid grid-cols-2 gap-2 p-4 pt-1 sm:p-5 sm:pt-1">
              <div className="rounded-xl bg-emerald-400/[0.065] p-3"><p className="text-xs text-muted-foreground">{t('seller.dashboard.analytics.fulfillmentStatus.success')}</p><p className="mt-1 text-lg font-bold text-emerald-400">{number(fulfillment.SUCCESS)}</p></div>
              <div className="rounded-xl bg-rose-400/[0.065] p-3"><p className="text-xs text-muted-foreground">{t('seller.dashboard.analytics.fulfillmentStatus.failed')}</p><p className="mt-1 text-lg font-bold text-rose-400">{number(fulfillment.FAILED)}</p></div>
              <div className="rounded-xl bg-primary/[0.065] p-3"><p className="text-xs text-muted-foreground">{t('seller.dashboard.analytics.fulfillmentStatus.pending')}</p><p className="mt-1 text-lg font-bold text-primary">{number(fulfillment.PENDING)}</p></div>
              <div className="rounded-xl bg-teal-400/[0.065] p-3"><p className="text-xs text-muted-foreground">{t('seller.dashboard.analytics.fulfillmentStatus.submitted')}</p><p className="mt-1 text-lg font-bold text-teal-300">{number(fulfillment.SUBMITTED)}</p></div>
            </CardContent>
          </Card>

          <Card className="f5r-glass-panel rounded-[22px]">
            <CardHeader className="p-4 pb-3 sm:p-5 sm:pb-3"><div className="flex items-start justify-between gap-3"><div><CardTitle className="text-base">{copy.setup}</CardTitle><CardDescription className="mt-1">{copy.setupHint}</CardDescription></div><Badge variant="outline" className={cn('shrink-0 rounded-lg', readinessHealthy ? 'border-emerald-400/15 bg-emerald-400/[0.09] text-emerald-300' : 'border-primary/15 bg-primary/[0.09] text-primary')}>{readinessHealthy ? copy.healthy : copy.needsAttention}</Badge></div></CardHeader>
            <CardContent className="space-y-1 p-4 pt-1 sm:p-5 sm:pt-1">
              <Link to="/seller/products" className="flex items-center justify-between rounded-xl px-3 py-2.5 transition-colors hover:bg-white/[0.035]"><span className="flex items-center gap-2 text-sm text-muted-foreground"><ShoppingBag className="h-4 w-4 text-primary" />{t('seller.dashboard.cards.products')}</span>{productsQuery.isLoading ? <Skeleton className="h-5 w-8" /> : <strong>{number(productsQuery.data?.length ?? 0)}</strong>}</Link>
              <Link to="/seller/smm-providers" className="flex items-center justify-between rounded-xl px-3 py-2.5 transition-colors hover:bg-white/[0.035]"><span className="flex items-center gap-2 text-sm text-muted-foreground"><Server className="h-4 w-4 text-primary" />{t('seller.dashboard.cards.providers')}</span>{providersQuery.isLoading ? <Skeleton className="h-5 w-8" /> : <strong>{number(providersQuery.data?.length ?? 0)}</strong>}</Link>
              <div className="flex items-center justify-between rounded-xl px-3 py-2.5"><span className="flex items-center gap-2 text-sm text-muted-foreground"><Webhook className="h-4 w-4 text-teal-300" />{copy.webhookQueue}</span><strong>{number(webhookBacklog)}</strong></div>
              <div className="flex items-center justify-between rounded-xl px-3 py-2.5"><span className="flex items-center gap-2 text-sm text-muted-foreground"><TriangleAlert className="h-4 w-4 text-primary" />{copy.routingIssues}</span><strong>{number(routingIssues)}</strong></div>
              <Link to="/seller/compensation-bot" className="flex items-center justify-between rounded-xl px-3 py-2.5 transition-colors hover:bg-white/[0.035]"><span className="flex items-center gap-2 text-sm text-muted-foreground"><Bot className="h-4 w-4 text-primary" />{copy.compensationBot}</span><ForwardArrow className="h-4 w-4 text-muted-foreground" /></Link>
              <div className="mt-3 border-t border-white/[0.065] pt-4">
                <div className="mb-2 flex items-center justify-between gap-3 text-xs"><span className="flex items-center gap-2 text-muted-foreground"><CreditCard className="h-4 w-4 text-primary" />{copy.subscriptionUsage}</span><span className="font-semibold">{number(usedOrders)} {copy.of} {effectiveLimit === Infinity ? '∞' : number(effectiveLimit)}</span></div>
                <Progress value={usagePercent} className="h-1.5 bg-white/[0.065]" />
                <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground"><span>{t(`seller.account.plans.${plan}`)}</span><Link to="/seller/account" className="font-medium text-primary hover:underline">{t('seller.dashboard.subscription.manage')}</Link></div>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
