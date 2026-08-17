import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Ban, CheckSquare, Eye, PackageSearch, RotateCcw, Square } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import OrderDetailsDialog from '@/components/orders/OrderDetailsDialog';
import { ordersApi } from '@/api/orders';
import { toast } from '@/components/ui/use-toast';
import type { OrderStatus } from '@/types';
import type { SellerOrder } from '@/api/orders';

export default function SellerOrdersPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<OrderStatus | 'all'>('all');
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const queryClient = useQueryClient();

  const PAGE_SIZE = 20;
  const [page, setPage] = useState(1);
  const [loadedOrders, setLoadedOrders] = useState<SellerOrder[]>([]);
  const [total, setTotal] = useState<number | null>(null);

  const filters = status === 'all' ? {} : { status };

  const ordersQuery = useQuery({
    queryKey: ['orders', 'seller', filters, page],
    queryFn: () => ordersApi.getAllOrders(filters, page, PAGE_SIZE),
    staleTime: 15_000,
  });
  const openOrderId = searchParams.get('open');
  const openOrderQuery = useQuery({
    queryKey: ['orders', 'seller', 'detail', openOrderId],
    queryFn: () => ordersApi.getOrderById(openOrderId!),
    enabled: !!openOrderId,
    staleTime: 15_000,
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

  useEffect(() => {
    setPage(1);
    setLoadedOrders([]);
    setTotal(null);
    setSelectedOrderIds([]);
  }, [status]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return loadedOrders;
    return loadedOrders.filter((o) => {
      const hay = `${o.id} ${o.service_name ?? ''} ${o.link ?? ''} ${o.salla_order_id ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [loadedOrders, query]);
  const dialogOrder = useMemo(() => {
    if (!openOrderId) return null;
    return loadedOrders.find((o) => (o.internal_id ?? o.id) === openOrderId || o.id === openOrderId) ?? openOrderQuery.data ?? null;
  }, [loadedOrders, openOrderId, openOrderQuery.data]);

  const isRepeatEligible = (order: SellerOrder) => {
    if (order.fulfillments.failed > 0) return true;
    if (order.status === 'failed' || order.status === 'partial') return true;
    return order.items.some((item) => item.fulfillment_status === 'FAILED' || item.fulfillment_status === 'PARTIAL');
  };

  const isCancelEligible = (order: SellerOrder) => {
    if (order.status === 'pending' || order.status === 'submitted') return true;
    return order.fulfillments.pending > 0 || order.fulfillments.submitted > 0;
  };

  const visibleEligibleIds = useMemo(
    () => filtered.filter((order) => isRepeatEligible(order) || isCancelEligible(order)).map((order) => order.internal_id ?? order.id),
    [filtered],
  );
  const selectedEligibleCount = selectedOrderIds.filter((id) => visibleEligibleIds.includes(id)).length;
  const selectAllState: boolean | 'indeterminate' =
    visibleEligibleIds.length === 0
      ? false
      : selectedEligibleCount === 0
        ? false
        : selectedEligibleCount === visibleEligibleIds.length
          ? true
          : 'indeterminate';

  const repeatMutation = useMutation({
    mutationFn: (orderIds: string[]) => ordersApi.repeatFailedOrders(orderIds),
    onSuccess: async (result) => {
      setSelectedOrderIds([]);
      await queryClient.invalidateQueries({ queryKey: ['orders', 'seller'] });
      if (result.created_fulfillments > 0) {
        toast({
          title: t('common.success'),
          description: t('seller.orders.repeat.toasts.success', {
            orders: result.repeated_orders,
            fulfillments: result.created_fulfillments,
            defaultValue: `Repeated ${result.repeated_orders} orders and queued ${result.created_fulfillments} failed fulfillments.`,
          }),
        });
      } else {
        toast({
          title: t('common.error'),
          description: t('seller.orders.repeat.toasts.none', {
            defaultValue: 'No eligible failed fulfillments were found in the selected orders.',
          }),
          variant: 'destructive',
        });
      }
    },
    onError: (error: Error) => {
      toast({ title: t('common.error'), description: error.message, variant: 'destructive' });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (orderIds: string[]) => ordersApi.cancelPendingOrders(orderIds),
    onSuccess: async (result) => {
      setSelectedOrderIds([]);
      await queryClient.invalidateQueries({ queryKey: ['orders', 'seller'] });
      if (result.cancelled_orders > 0) {
        toast({
          title: t('common.success'),
          description: t('seller.orders.cancel.toasts.success', {
            orders: result.cancelled_orders,
            fulfillments: result.cancelled_fulfillments,
            defaultValue: `Cancelled ${result.cancelled_orders} orders and stopped ${result.cancelled_fulfillments} pending fulfillments.`,
          }),
        });
      } else {
        toast({
          title: t('common.error'),
          description: t('seller.orders.cancel.toasts.none', {
            defaultValue: 'No cancellable pending orders were found in the selected orders.',
          }),
          variant: 'destructive',
        });
      }
    },
    onError: (error: Error) => {
      toast({ title: t('common.error'), description: error.message, variant: 'destructive' });
    },
  });

  const selectedRepeatIds = selectedOrderIds.filter((id) => {
    const order = loadedOrders.find((entry) => (entry.internal_id ?? entry.id) === id);
    return order ? isRepeatEligible(order) : false;
  });

  const selectedCancelIds = selectedOrderIds.filter((id) => {
    const order = loadedOrders.find((entry) => (entry.internal_id ?? entry.id) === id);
    return order ? isCancelEligible(order) : false;
  });

  const toggleSelectedOrder = (orderId: string, checked: boolean) => {
    setSelectedOrderIds((prev) => {
      if (checked) return prev.includes(orderId) ? prev : [...prev, orderId];
      return prev.filter((id) => id !== orderId);
    });
  };

  const toggleSelectAllVisible = (checked: boolean) => {
    setSelectedOrderIds((prev) => {
      if (!checked) return prev.filter((id) => !visibleEligibleIds.includes(id));
      const next = new Set(prev);
      for (const id of visibleEligibleIds) next.add(id);
      return Array.from(next);
    });
  };

  const statusColor = (s: OrderStatus) => {
    if (s === 'completed') return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400';
    if (s === 'failed' || s === 'cancelled') return 'bg-rose-500/10 text-rose-700 dark:text-rose-400';
    if (s === 'in_progress' || s === 'approved' || s === 'submitted') return 'bg-sky-500/10 text-sky-700 dark:text-sky-400';
    return 'bg-amber-500/10 text-amber-700 dark:text-amber-400';
  };

  const statusLabel = (s: OrderStatus) => t(`orders.status.${s}`, { defaultValue: s });

  const routingSummary = (order: (typeof loadedOrders)[number]) => {
    const reasons = order.routing?.reasons;
    if (!reasons) return null;

    const parts: string[] = [];
    if (reasons.unmapped_product > 0) parts.push(t('orders.details.routing.unmappedCount', { count: reasons.unmapped_product }));
    if (reasons.product_inactive > 0) parts.push(t('orders.details.routing.reasons.product_inactive_short', { count: reasons.product_inactive }));
    if (reasons.no_rule > 0) parts.push(t('orders.details.routing.reasons.no_rule_short', { count: reasons.no_rule }));
    if (reasons.provider_inactive > 0) parts.push(t('orders.details.routing.reasons.provider_inactive_short', { count: reasons.provider_inactive }));
    if (reasons.ready > 0) parts.push(t('orders.details.routing.reasons.ready_short', { count: reasons.ready }));

    return parts.length ? parts.join(' • ') : null;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('seller.nav.orders')}</h1>
        <p className="text-sm text-muted-foreground">{t('seller.orders.subtitle')}</p>
      </div>

      <Card>
        <CardHeader className="gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>{t('seller.orders.listTitle')}</CardTitle>
            <CardDescription>{t('seller.orders.listHint')}</CardDescription>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <div className="relative w-full sm:w-72">
              <PackageSearch className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9"
                placeholder={t('seller.orders.searchPlaceholder')}
              />
            </div>
            <Select value={status} onValueChange={(v) => setStatus(v as OrderStatus | 'all')}>
              <SelectTrigger className="w-full sm:w-44">
                <SelectValue placeholder={t('common.filter')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('common.all')}</SelectItem>
                <SelectItem value="pending">{statusLabel('pending')}</SelectItem>
                <SelectItem value="approved">{statusLabel('approved')}</SelectItem>
                <SelectItem value="submitted">{statusLabel('submitted')}</SelectItem>
                <SelectItem value="in_progress">{statusLabel('in_progress')}</SelectItem>
                <SelectItem value="completed">{statusLabel('completed')}</SelectItem>
                <SelectItem value="partial">{statusLabel('partial')}</SelectItem>
                <SelectItem value="failed">{statusLabel('failed')}</SelectItem>
                <SelectItem value="refunded">{statusLabel('refunded')}</SelectItem>
                <SelectItem value="cancelled">{statusLabel('cancelled')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {selectedOrderIds.length > 0 ? (
            <div className="mb-4 flex flex-col gap-3 rounded-lg border border-border/60 bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                {t('seller.orders.repeat.selected', {
                  count: selectedOrderIds.length,
                  defaultValue: `${selectedOrderIds.length} orders selected`,
                })}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  onClick={() => setSelectedOrderIds([])}
                  disabled={repeatMutation.isPending || cancelMutation.isPending}
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  onClick={() => repeatMutation.mutate(selectedRepeatIds)}
                  disabled={repeatMutation.isPending || selectedRepeatIds.length === 0}
                  className="gap-2"
                >
                  <RotateCcw className="h-4 w-4" />
                  {t('seller.orders.repeat.action', { defaultValue: 'Repeat selected orders' })}
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => cancelMutation.mutate(selectedCancelIds)}
                  disabled={cancelMutation.isPending || selectedCancelIds.length === 0}
                  className="gap-2"
                >
                  <Ban className="h-4 w-4" />
                  {t('seller.orders.cancel.action', { defaultValue: 'Cancel selected pending orders' })}
                </Button>
              </div>
            </div>
          ) : null}
          {ordersQuery.isLoading && loadedOrders.length === 0 ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('seller.orders.empty')}</p>
          ) : (
            <div className="space-y-4 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12 hidden sm:table-cell">
                      <Checkbox
                        checked={selectAllState}
                        onCheckedChange={(checked) => toggleSelectAllVisible(checked === true)}
                        aria-label={t('seller.orders.repeat.selectAll', { defaultValue: 'Select all failed orders' })}
                        disabled={visibleEligibleIds.length === 0}
                      />
                    </TableHead>
                    <TableHead>{t('orders.columns.id')}</TableHead>
                    <TableHead>{t('orders.columns.service')}</TableHead>
                    <TableHead className="hidden md:table-cell">{t('orders.columns.platform')}</TableHead>
                    <TableHead className="hidden md:table-cell">{t('orders.columns.quantity')}</TableHead>
                    <TableHead>{t('orders.columns.status')}</TableHead>
                    <TableHead className="hidden lg:table-cell text-right">{t('orders.columns.cost', { defaultValue: 'Cost' })}</TableHead>
                    <TableHead className="hidden lg:table-cell text-right">{t('orders.columns.profit', { defaultValue: 'Profit' })}</TableHead>
                    <TableHead className="text-right">{t('orders.columns.total')}</TableHead>
                    <TableHead className="text-right">{t('common.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((o) => (
                    <TableRow key={o.internal_id ?? o.id}>
                      <TableCell className="hidden sm:table-cell">
                        <Checkbox
                          checked={selectedOrderIds.includes(o.internal_id ?? o.id)}
                          onCheckedChange={(checked) => toggleSelectedOrder(o.internal_id ?? o.id, checked === true)}
                          aria-label={t('seller.orders.repeat.selectOne', {
                            defaultValue: `Select order ${o.salla_order_id ?? o.id}`,
                          })}
                          disabled={!isRepeatEligible(o) && !isCancelEligible(o)}
                        />
                      </TableCell>
                      <TableCell className="font-medium">
                        <div className="flex items-center justify-between gap-2">
                          <span>{o.salla_order_id ?? o.id}</span>
                          <Button
                            type="button"
                            variant={selectedOrderIds.includes(o.internal_id ?? o.id) ? 'default' : 'outline'}
                            size="sm"
                            className="gap-2 sm:hidden"
                            disabled={!isRepeatEligible(o) && !isCancelEligible(o)}
                            onClick={() =>
                              toggleSelectedOrder(
                                o.internal_id ?? o.id,
                                !selectedOrderIds.includes(o.internal_id ?? o.id),
                              )
                            }
                          >
                            {selectedOrderIds.includes(o.internal_id ?? o.id) ? (
                              <CheckSquare className="h-4 w-4" />
                            ) : (
                              <Square className="h-4 w-4" />
                            )}
                            {t('common.select', { defaultValue: 'Select' })}
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[40ch]">
                        <div className="min-w-0">
                          <p className="truncate">{o.service_name ?? '-'}</p>
                          {o.link ? <p className="truncate text-xs text-muted-foreground">{o.link}</p> : null}
                          {o.routing?.state === 'unrouted' ? (
                            <p className="truncate text-xs text-amber-700 dark:text-amber-400">
                              {t('orders.details.routing.unrouted')}
                              {(() => {
                                const summary = routingSummary(o);
                                return summary ? ` - ${summary}` : '';
                              })()}
                            </p>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">{o.platform ?? '-'}</TableCell>
                      <TableCell className="hidden md:table-cell">{o.quantity}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className={statusColor(o.status)}>
                          {statusLabel(o.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-right">
                        {typeof o.costStore === 'number' ? `${o.costStore.toFixed(2)} ${o.currency ?? t('common.currency')}` : '-'}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-right">
                        {typeof o.profitStore === 'number' ? `${o.profitStore.toFixed(2)} ${o.currency ?? t('common.currency')}` : '-'}
                      </TableCell>
                      <TableCell className="text-right">
                        {Number(o.totalPrice ?? 0).toFixed(2)} {o.currency ?? t('common.currency')}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            type="button"
                            variant={selectedOrderIds.includes(o.internal_id ?? o.id) ? 'default' : 'outline'}
                            size="sm"
                            className="hidden gap-2 sm:inline-flex"
                            disabled={!isRepeatEligible(o) && !isCancelEligible(o)}
                            onClick={() =>
                              toggleSelectedOrder(
                                o.internal_id ?? o.id,
                                !selectedOrderIds.includes(o.internal_id ?? o.id),
                              )
                            }
                          >
                            {selectedOrderIds.includes(o.internal_id ?? o.id) ? (
                              <CheckSquare className="h-4 w-4" />
                            ) : (
                              <Square className="h-4 w-4" />
                            )}
                            {t('common.select', { defaultValue: 'Select' })}
                          </Button>
                          <OrderDetailsDialog
                            order={o}
                            trigger={
                              <Button variant="ghost" size="icon">
                                <Eye className="h-4 w-4" />
                              </Button>
                            }
                          />
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

      {dialogOrder ? (
        <OrderDetailsDialog
          order={dialogOrder}
          open={!!openOrderId}
          onOpenChange={(nextOpen) => {
            if (nextOpen) return;
            const next = new URLSearchParams(searchParams);
            next.delete('open');
            setSearchParams(next, { replace: true });
          }}
        />
      ) : null}
    </div>
  );
}
