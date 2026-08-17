import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useSellerAnalytics } from '@/hooks/useApi';
import { cn } from '@/lib/utils';

type Range = 'day' | 'week' | 'month' | 'all';

function daysForRange(range: Range) {
  if (range === 'day') return 1;
  if (range === 'week') return 7;
  if (range === 'month') return 30;
  return 90;
}

export default function SellerAnalyticsPage() {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const [range, setRange] = useState<Range>('week');
  const days = useMemo(() => daysForRange(range), [range]);

  const analyticsQuery = useSellerAnalytics(days);
  const analytics = analyticsQuery.data?.data;

  const ranges: Array<{ key: Range }> = [{ key: 'day' }, { key: 'week' }, { key: 'month' }, { key: 'all' }];
  const rangeLabel = useMemo(() => t(`seller.analyticsPage.range.${range}`), [range, t]);

  const successRatePct =
    analytics?.kpi.fulfillmentsSuccessRate30d == null ? null : Math.round(analytics.kpi.fulfillmentsSuccessRate30d * 100);

  const ordersInRange =
    range === 'all'
      ? (analytics?.kpi.totalOrders ?? 0)
      : (analytics?.ordersByDay?.reduce((sum, d) => sum + d.orders, 0) ?? 0);
  const revenueInRange = analytics?.ordersByDay?.reduce((sum, d) => sum + d.revenue, 0) ?? 0;

  return (
    <div className="space-y-6 pb-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('seller.analyticsPage.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('seller.analyticsPage.subtitle', { range: rangeLabel })}</p>
        </div>
        <div className="inline-flex w-full gap-2 sm:w-auto">
          {ranges.map((r) => (
            <Button
              key={r.key}
              type="button"
              variant={range === r.key ? 'default' : 'outline'}
              className={cn('w-full sm:w-auto', range === r.key && 'btn-primary')}
              onClick={() => setRange(r.key)}
            >
              {t(`seller.analyticsPage.range.${r.key}`)}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t('seller.analyticsPage.kpi.orders')} ({rangeLabel})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {analyticsQuery.isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div>
                <div className="text-2xl font-bold">{ordersInRange}</div>
                {range !== 'all' && analytics?.kpi.totalOrders != null && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t('seller.analyticsPage.kpi.totalOrdersAllTime', { count: analytics.kpi.totalOrders })}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t('seller.analyticsPage.kpi.revenue')} ({rangeLabel})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {analyticsQuery.isLoading ? (
              <Skeleton className="h-8 w-28" />
            ) : (
              <div>
                <div className="text-2xl font-bold">
                  {Number(revenueInRange).toFixed(2)} {t('common.currency')}
                </div>
                {range !== 'all' && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t('seller.analyticsPage.kpi.revenue30d', {
                      amount: `${Number(analytics?.kpi.revenueLast30d ?? 0).toFixed(2)} ${t('common.currency')}`,
                    })}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t('seller.analyticsPage.kpi.successRate')}</CardTitle>
          </CardHeader>
          <CardContent>
            {analyticsQuery.isLoading ? <Skeleton className="h-8 w-20" /> : <div className="text-2xl font-bold">{successRatePct == null ? '—' : `${successRatePct}%`}</div>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t('seller.analyticsPage.kpi.webhookBacklog')}</CardTitle>
          </CardHeader>
          <CardContent>
            {analyticsQuery.isLoading ? <Skeleton className="h-8 w-20" /> : <div className="text-2xl font-bold">{analytics?.webhooks.backlog ?? 0}</div>}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('seller.analyticsPage.ordersByDayTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            {analyticsQuery.isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : !analytics?.ordersByDay?.length ? (
              <p className="text-sm text-muted-foreground">{t('seller.analyticsPage.empty')}</p>
            ) : (
              <div className={cn('max-h-[min(24rem,60vh)] overflow-y-auto overflow-x-auto', isRTL && '[direction:rtl]')}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('seller.dashboard.analytics.columns.day')}</TableHead>
                      <TableHead>{t('seller.dashboard.analytics.columns.orders')}</TableHead>
                      <TableHead className="text-right">{t('seller.dashboard.analytics.columns.revenue')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {analytics.ordersByDay.map((d) => (
                      <TableRow key={d.day}>
                        <TableCell className="font-medium">{d.day}</TableCell>
                        <TableCell>{d.orders}</TableCell>
                        <TableCell className="text-right">
                          {d.revenue.toFixed(2)} {t('common.currency')}
                        </TableCell>
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
            <CardTitle>{t('seller.analyticsPage.topProvidersTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            {analyticsQuery.isLoading ? (
              <Skeleton className="h-28 w-full" />
            ) : !analytics?.topProviders?.length ? (
              <p className="text-sm text-muted-foreground">{t('seller.analyticsPage.empty')}</p>
            ) : (
              <div className={cn('max-h-[min(24rem,60vh)] overflow-y-auto overflow-x-auto', isRTL && '[direction:rtl]')}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('seller.dashboard.analytics.columns.provider')}</TableHead>
                      <TableHead className="text-right">{t('seller.dashboard.analytics.columns.total')}</TableHead>
                      <TableHead className="text-right">{t('seller.dashboard.analytics.columns.failed')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {analytics.topProviders.map((p) => (
                      <TableRow key={p.provider_id}>
                        <TableCell className="font-medium">{p.name}</TableCell>
                        <TableCell className="text-right">{p.total}</TableCell>
                        <TableCell className="text-right">
                          <Badge variant="secondary" className={p.failed > 0 ? 'bg-rose-500/10 text-rose-700 dark:text-rose-400' : ''}>
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
    </div>
  );
}

