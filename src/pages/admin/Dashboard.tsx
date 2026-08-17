import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { useAdminAnalytics } from '@/hooks/useApi';

export default function AdminDashboardPage() {
  const { t } = useTranslation();
  const analyticsQuery = useAdminAnalytics(14);
  const analytics = analyticsQuery.data?.data;

  const stats = [
    { label: t('admin.stats.totalOrders'), value: analytics?.kpi.totalOrders ?? 0 },
    { label: t('admin.stats.totalUsers'), value: analytics?.kpi.totalUsers ?? 0 },
    { label: t('admin.stats.totalSellers'), value: analytics?.kpi.totalSellers ?? 0 },
    { label: t('admin.analytics.kpi.ordersLast7d'), value: analytics?.kpi.ordersLast7d ?? 0 },
    { label: t('admin.analytics.kpi.revenueLast30d'), value: `${(analytics?.kpi.revenueLast30d ?? 0).toFixed(2)} ${t('common.currency')}` },
    { label: t('admin.analytics.kpi.pendingFulfillments'), value: analytics?.kpi.pendingFulfillments ?? 0 },
    { label: t('admin.analytics.kpi.failedFulfillmentsLast7d'), value: analytics?.kpi.failedFulfillmentsLast7d ?? 0 },
    { label: t('admin.analytics.kpi.webhookBacklog'), value: analytics?.kpi.webhookBacklog ?? 0 },
    { label: t('admin.analytics.kpi.pendingUpgradeRequests'), value: analytics?.kpi.pendingUpgradeRequests ?? 0 },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('admin.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('admin.dashboardSubtitle')}</p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
      >
        {stats.map((s) => (
          <Card key={s.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{s.label}</CardTitle>
            </CardHeader>
            <CardContent>
              {analyticsQuery.isLoading ? <Skeleton className="h-8 w-24" /> : <div className="text-2xl font-bold">{s.value}</div>}
            </CardContent>
          </Card>
        ))}
      </motion.div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('admin.analytics.ordersByDayTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            {analyticsQuery.isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : !analytics?.ordersByDay?.length ? (
              <p className="text-sm text-muted-foreground">{t('admin.analytics.empty')}</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('admin.analytics.columns.day')}</TableHead>
                      <TableHead>{t('admin.analytics.columns.orders')}</TableHead>
                      <TableHead className="text-right">{t('admin.analytics.columns.revenue')}</TableHead>
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
            <CardTitle>{t('admin.analytics.topSellersTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            {analyticsQuery.isLoading ? (
              <Skeleton className="h-28 w-full" />
            ) : !analytics?.topSellers?.length ? (
              <p className="text-sm text-muted-foreground">{t('admin.analytics.empty')}</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('admin.analytics.columns.seller')}</TableHead>
                      <TableHead className="text-right">{t('admin.analytics.columns.orders')}</TableHead>
                      <TableHead className="text-right">{t('admin.analytics.columns.revenue')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {analytics.topSellers.map((s) => (
                      <TableRow key={s.seller_id}>
                        <TableCell className="font-medium">
                          <div className="flex flex-col">
                            <span>{s.name}</span>
                            <span className="text-xs text-muted-foreground">{s.email}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">{s.orders}</TableCell>
                        <TableCell className="text-right">
                          {Number(s.revenue || 0).toFixed(2)} {t('common.currency')}
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

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('admin.analytics.topProvidersTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            {analyticsQuery.isLoading ? (
              <Skeleton className="h-28 w-full" />
            ) : !analytics?.topProviders?.length ? (
              <p className="text-sm text-muted-foreground">{t('admin.analytics.empty')}</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('admin.analytics.columns.provider')}</TableHead>
                      <TableHead className="text-right">{t('admin.analytics.columns.total')}</TableHead>
                      <TableHead className="text-right">{t('admin.analytics.columns.failed')}</TableHead>
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

        <Card>
          <CardHeader>
            <CardTitle>{t('admin.analytics.fulfillmentsTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            {analyticsQuery.isLoading ? (
              <Skeleton className="h-28 w-full" />
            ) : (
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{t('admin.analytics.fulfillmentStatus.pending')}</span>
                  <span className="font-medium">{analytics?.fulfillmentsByStatus.PENDING ?? 0}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{t('admin.analytics.fulfillmentStatus.submitted')}</span>
                  <span className="font-medium">{analytics?.fulfillmentsByStatus.SUBMITTED ?? 0}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{t('admin.analytics.fulfillmentStatus.success')}</span>
                  <span className="font-medium">{analytics?.fulfillmentsByStatus.SUCCESS ?? 0}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{t('admin.analytics.fulfillmentStatus.failed')}</span>
                  <span className="font-medium">{analytics?.fulfillmentsByStatus.FAILED ?? 0}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
