import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useUserOrders } from '@/hooks/useApi';

export default function AccountOrdersPage() {
  const { t } = useTranslation();
  const { data, isLoading } = useUserOrders();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('orders.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('account.title')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('orders.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : !data?.data?.length ? (
            <p className="text-sm text-muted-foreground">{t('orders.empty')}</p>
          ) : (
            data.data.map((o) => (
              <div key={o.internal_id ?? o.id} className="flex flex-col gap-2 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium">{o.salla_order_id ?? o.id}</p>
                  <p className="text-xs text-muted-foreground">{o.service_name || '-'}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{o.status}</Badge>
                  <p className="text-sm font-semibold">
                    {Number(o.totalPrice ?? 0).toFixed(2)} {t('common.currency')}
                  </p>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
