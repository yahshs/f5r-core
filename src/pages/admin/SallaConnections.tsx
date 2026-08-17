import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useAdminSallaConnections, useUpdateAdminSalla, useRotateAdminSallaToken } from '@/hooks/useApi';
import type { AdminSallaConnection } from '@/api/adminSalla';

export default function AdminSallaConnectionsPage() {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [editForm, setEditForm] = useState<AdminSallaConnection | null>(null);
  const [tokenForm, setTokenForm] = useState<{ sellerId: string; token: string } | null>(null);
  const connectionsQuery = useAdminSallaConnections();
  const updateConn = useUpdateAdminSalla();
  const rotateToken = useRotateAdminSallaToken();

  const connections = connectionsQuery.data?.data ?? [];

  const filtered = useMemo(() => {
    if (!query.trim()) return connections;
    const q = query.trim().toLowerCase();
    return connections.filter((c) => `${c.seller_email ?? ''} ${c.public_webhook_id ?? ''}`.toLowerCase().includes(q));
  }, [connections, query]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('admin.sallaConnections')}</h1>
        <p className="text-sm text-muted-foreground">{t('admin.sallaConnectionsSubtitle')}</p>
      </div>

      <Card>
        <CardHeader className="gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>{t('admin.sallaConnections')}</CardTitle>
            <CardDescription>{t('admin.sallaConnectionsHint')}</CardDescription>
          </div>
          <Input className="w-full sm:w-72" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('common.search')} />
        </CardHeader>
        <CardContent className="space-y-3">
          {connectionsQuery.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('common.empty')}</p>
          ) : (
            filtered.map((conn) => (
              <div key={conn.id} className="flex flex-col gap-2 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium">{conn.seller_email ?? '-'}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {conn.salla_store_name || conn.salla_store_id || conn.webhook_url || '-'}
                  </p>
                  {conn.last_event_at ? (
                    <p className="text-xs text-muted-foreground">{t('seller.salla.lastEventAt')}: {new Date(conn.last_event_at).toLocaleString()}</p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{conn.is_enabled ? t('common.active') : t('common.inactive')}</Badge>
                  <Badge variant="outline">{conn.connection_mode}</Badge>
                  <Badge variant="outline">{conn.status}</Badge>
                  <Badge variant="outline">{conn.payment_status_filter}</Badge>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setEditForm({ ...conn })}>{t('common.edit')}</Button>
                  {conn.connection_mode === 'manual' ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        rotateToken.mutate(conn.seller_id, {
                          onSuccess: (res) => setTokenForm({ sellerId: conn.seller_id, token: res.data.token }),
                        });
                      }}
                    >
                      {t('admin.sallaRotateToken')}
                    </Button>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editForm} onOpenChange={() => setEditForm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.sallaEdit')}</DialogTitle>
          </DialogHeader>
          {editForm ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <p className="text-sm font-medium">{t('admin.sallaEnabled')}</p>
                </div>
                <Switch checked={!!editForm.is_enabled} onCheckedChange={(v) => setEditForm({ ...editForm, is_enabled: v ? 1 : 0 })} />
              </div>
              <div>
                <Label>{t('admin.sallaPaymentStatus')}</Label>
                <Select value={editForm.payment_status_filter} onValueChange={(v) => setEditForm({ ...editForm, payment_status_filter: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">all</SelectItem>
                    <SelectItem value="paid">paid</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setEditForm(null)}>{t('common.cancel')}</Button>
            <Button
              onClick={() => {
                if (!editForm) return;
                updateConn.mutate({ sellerId: editForm.seller_id, input: { is_enabled: !!editForm.is_enabled, payment_status_filter: editForm.payment_status_filter } });
                setEditForm(null);
              }}
              disabled={updateConn.isPending}
            >
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!tokenForm} onOpenChange={() => setTokenForm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.sallaTokenTitle')}</DialogTitle>
          </DialogHeader>
          {tokenForm ? (
            <div className="space-y-2">
              <Label>{t('admin.sallaTokenLabel')}</Label>
              <Input readOnly value={tokenForm.token} />
            </div>
          ) : null}
          <DialogFooter>
            <Button onClick={() => setTokenForm(null)}>{t('common.close')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
