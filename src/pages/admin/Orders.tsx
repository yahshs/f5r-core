import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import OrderDetailsDialog from '@/components/orders/OrderDetailsDialog';
import { useDeleteOrder } from '@/hooks/useApi';
import { ordersApi } from '@/api/orders';
import { Eye, Trash2 } from 'lucide-react';
import type { OrderStatus } from '@/types';
import type { SellerOrder } from '@/api/orders';
import { useAuthStore } from '@/store';

export default function AdminOrdersPage() {
  const adminId = useAuthStore((state) => state.user?.id);
  return <AdminOrdersContent key={adminId ?? 'anonymous'} adminId={adminId} />;
}

function AdminOrdersContent({ adminId }: { adminId: string | undefined }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const PAGE_SIZE = 20;
  const [page, setPage] = useState(1);
  const [loadedOrders, setLoadedOrders] = useState<SellerOrder[]>([]);
  const [total, setTotal] = useState<number | null>(null);

  const ordersQuery = useQuery({
    queryKey: ['orders', 'admin', adminId, page, PAGE_SIZE],
    queryFn: () => ordersApi.getAllOrders({}, page, PAGE_SIZE),
    enabled: !!adminId,
    staleTime: 15_000,
    refetchInterval: 15_000,
  });

  useEffect(() => {
    if (!ordersQuery.data) return;
    const resp = ordersQuery.data;
    setTotal(resp.total ?? null);

    setLoadedOrders((prev) => {
      const next = page === 1 ? [] : prev;
      const byId = new Map<string, SellerOrder>();
      for (const o of next) byId.set(o.internal_id ?? o.id, o);
      for (const o of resp.data ?? []) byId.set(o.internal_id ?? o.id, o);
      return Array.from(byId.values());
    });
  }, [ordersQuery.data, page]);
  const deleteOrder = useDeleteOrder();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return loadedOrders;
    return loadedOrders.filter((o) => `${o.salla_order_id ?? o.id} ${o.service_name ?? ''} ${o.link ?? ''}`.toLowerCase().includes(q));
  }, [loadedOrders, query]);

  const statusColor = (s: OrderStatus) => {
    if (s === 'completed') return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400';
    if (s === 'failed' || s === 'cancelled') return 'bg-rose-500/10 text-rose-700 dark:text-rose-400';
    if (s === 'in_progress' || s === 'approved' || s === 'submitted') return 'bg-sky-500/10 text-sky-700 dark:text-sky-400';
    return 'bg-amber-500/10 text-amber-700 dark:text-amber-400';
  };

  const statusLabel = (s: OrderStatus) => t(`orders.status.${s}`, { defaultValue: s });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('admin.orders')}</h1>
        <p className="text-sm text-muted-foreground">{t('orders.title')}</p>
      </div>

      <Card>
        <CardHeader className="gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>{t('admin.orders')}</CardTitle>
            <CardDescription>{t('orders.empty')}</CardDescription>
          </div>
          <div className="flex gap-2">
            <Input className="w-full sm:w-72" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('common.search')} />
            <Button variant="outline" disabled={ordersQuery.isFetching} onClick={() => void ordersQuery.refetch()}>{t('common.refresh')}</Button>
          </div>
        </CardHeader>
        <CardContent>
          {ordersQuery.isError ? (
            <div role="alert" className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
              <p>{t('seller.orders.loadError')}</p>
              <p className="mt-1 text-muted-foreground">{ordersQuery.error.message}</p>
            </div>
          ) : null}
          {ordersQuery.isLoading && loadedOrders.length === 0 ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : ordersQuery.isError && loadedOrders.length === 0 ? null : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('orders.empty')}</p>
          ) : (
            <div className="space-y-4 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('orders.columns.id')}</TableHead>
                    <TableHead>{t('orders.columns.service')}</TableHead>
                    <TableHead>{t('orders.columns.status')}</TableHead>
                    <TableHead className="text-right">{t('orders.columns.total')}</TableHead>
                    <TableHead className="text-right">{t('common.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((o) => (
                    <TableRow key={o.internal_id ?? o.id}>
                      <TableCell className="font-medium">{o.salla_order_id ?? o.id}</TableCell>
                      <TableCell className="max-w-[36ch]">
                        <div className="min-w-0">
                          <p className="truncate">{o.service_name ?? '-'}</p>
                          {o.link ? <p className="truncate text-xs text-muted-foreground">{o.link}</p> : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={statusColor(o.status)}>
                          {statusLabel(o.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{Number(o.totalPrice ?? 0).toFixed(2)} {o.currency ?? t('common.currency')}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <OrderDetailsDialog
                            order={o}
                            trigger={(
                              <Button variant="ghost" size="icon">
                                <Eye className="h-4 w-4" />
                              </Button>
                            )}
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive"
                            disabled={deleteOrder.isPending}
                            onClick={() => {
                              const ok = window.confirm(t('admin.ordersDeleteConfirm'));
                              if (!ok) return;
                              deleteOrder.mutate(o.internal_id ?? o.id);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {typeof total === 'number' && loadedOrders.length < total ? (
                <div className="flex justify-center">
                  <Button
                    variant="secondary"
                    disabled={ordersQuery.isFetching}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    {t('common.loadMore')}
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
