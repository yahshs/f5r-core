import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Download, Link2, RefreshCcw, Unplug, Webhook } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  useDisconnectSellerSalla,
  useRotateSellerSallaToken,
  useSaveSellerSallaConfig,
  useSellerSallaMetrics,
  useSellerSallaRecentActivity,
  useSellerSallaStatus,
  useSellerSallaWebhookInfo,
  useSimulateSellerSallaCreateOrder,
  useStartSellerSallaConnect,
} from '@/hooks/useApi';
import { sellerSallaApi } from '@/api/sellerSalla';
import { useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export default function SellerSallaIntegrationPage() {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const queryClient = useQueryClient();

  const statusQuery = useSellerSallaStatus();
  const webhookInfoQuery = useSellerSallaWebhookInfo();
  const metricsQuery = useSellerSallaMetrics();
  const recentQuery = useSellerSallaRecentActivity();
  const saveMutation = useSaveSellerSallaConfig();
  const rotateMutation = useRotateSellerSallaToken();
  const simulateMutation = useSimulateSellerSallaCreateOrder();
  const connectMutation = useStartSellerSallaConnect();
  const disconnectMutation = useDisconnectSellerSalla();

  const [enabled, setEnabled] = useState(true);
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<'all' | 'paid'>('all');
  const [duplicateDelayEnabled, setDuplicateDelayEnabled] = useState(false);
  const [duplicateDelayMinutes, setDuplicateDelayMinutes] = useState(5);
  const [newToken, setNewToken] = useState<string | null>(null);

  const status = statusQuery.data;
  const connected = status?.connected ?? false;
  const isManual = status?.connection_mode === 'manual';

  useEffect(() => {
    if (!status) return;
    setEnabled(!!status.is_enabled);
    setPaymentStatusFilter(status.payment_status_filter ?? 'all');
    const seconds = Number(status.duplicate_link_delay_seconds ?? 0);
    if (Number.isFinite(seconds) && seconds > 0) {
      setDuplicateDelayEnabled(true);
      setDuplicateDelayMinutes(Math.max(1, Math.round(seconds / 60)));
    } else {
      setDuplicateDelayEnabled(false);
    }
  }, [status]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const connectState = url.searchParams.get('salla_connect');
    const message = url.searchParams.get('message');
    if (!connectState) return;

    if (connectState === 'success') {
      toast({ title: t('common.success'), description: t('seller.salla.connectSuccess', { defaultValue: 'Salla connected successfully.' }) });
      void queryClient.invalidateQueries({ queryKey: ['seller', 'salla'] });
    } else {
      toast({
        title: t('common.error'),
        description: message || t('seller.salla.connectFailed', { defaultValue: 'Failed to connect Salla.' }),
      });
    }

    url.searchParams.delete('salla_connect');
    url.searchParams.delete('message');
    window.history.replaceState({}, '', url.toString());
  }, [queryClient, t]);

  const headersText = useMemo(() => {
    const info = webhookInfoQuery.data;
    if (!info) return '';
    return info.required_headers.map((h) => `${h.name}: ${h.value}`).join('\n');
  }, [webhookInfoQuery.data]);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: t('common.success'), description: t('common.copied') });
    } catch {
      toast({ title: t('common.error'), description: t('common.copyFailed') });
    }
  };

  const save = async () => {
    try {
      const delaySeconds = duplicateDelayEnabled ? Math.max(1, Math.round(duplicateDelayMinutes)) * 60 : 0;
      await saveMutation.mutateAsync({
        is_enabled: enabled,
        payment_status_filter: paymentStatusFilter,
        duplicate_link_delay_seconds: delaySeconds,
      });
      toast({ title: t('common.success'), description: t('seller.salla.toasts.saved') });
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('common.error');
      toast({ title: t('common.error'), description: msg });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('seller.nav.salla')}</h1>
        <p className="text-sm text-muted-foreground">{t('seller.salla.subtitle')}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Link2 className="h-5 w-5" /> {t('seller.salla.connectionStatus')}
              </CardTitle>
              <CardDescription>{t('seller.salla.nativeConnectHint', { defaultValue: 'Connect your Salla private app and let F5R handle webhooks natively.' })}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">{t('seller.salla.connectionStatus')}</p>
                    <p className="text-xs text-muted-foreground">
                      {status?.salla_store_name || t('seller.salla.noStoreConnected', { defaultValue: 'No Salla store connected yet.' })}
                    </p>
                  </div>
                  <Badge variant="secondary" className={connected ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}>
                    {status?.status ?? 'disconnected'}
                  </Badge>
                </div>

                {status?.salla_store_id && (
                  <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                    <p>{t('seller.salla.storeId', { defaultValue: 'Store ID' })}: {status.salla_store_id}</p>
                    {status.salla_store_url ? <p>{t('seller.salla.storeUrl', { defaultValue: 'Store URL' })}: {status.salla_store_url}</p> : null}
                    {status.installed_at ? <p>{t('seller.salla.installedAt', { defaultValue: 'Installed at' })}: {new Date(status.installed_at).toLocaleString()}</p> : null}
                    {status.last_event_at ? <p>{t('seller.salla.lastEventAt')}: {new Date(status.last_event_at).toLocaleString()}</p> : null}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <Button
                  type="button"
                  className={cn('gap-2 btn-primary', isRTL && 'flex-row-reverse')}
                  disabled={connectMutation.isPending}
                  onClick={async () => {
                    try {
                      const data = await connectMutation.mutateAsync();
                      window.location.href = data.install_url;
                    } catch (e) {
                      const msg = e instanceof Error ? e.message : t('common.error');
                      toast({ title: t('common.error'), description: msg });
                    }
                  }}
                >
                  <Link2 className="h-4 w-4" />
                  {connected
                    ? t('seller.salla.reconnect', { defaultValue: 'Reconnect Salla' })
                    : t('seller.salla.connectButton', { defaultValue: 'Connect Salla' })}
                </Button>

                {status && (
                  <Button
                    type="button"
                    variant="outline"
                    className={cn('gap-2', isRTL && 'flex-row-reverse')}
                    disabled={disconnectMutation.isPending || status.status === 'disconnected'}
                    onClick={async () => {
                      try {
                        await disconnectMutation.mutateAsync();
                        toast({ title: t('common.success'), description: t('seller.salla.disconnected', { defaultValue: 'Salla disconnected.' }) });
                      } catch (e) {
                        const msg = e instanceof Error ? e.message : t('common.error');
                        toast({ title: t('common.error'), description: msg });
                      }
                    }}
                  >
                    <Unplug className="h-4 w-4" />
                    {t('seller.salla.disconnectButton', { defaultValue: 'Disconnect Salla' })}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
            <Card className="card-hover">
              <CardHeader className="pb-2">
                <CardDescription>{isRTL ? 'اليوم' : 'Today'}</CardDescription>
                <CardTitle className="text-2xl">{metricsQuery.data?.received_today ?? 0}</CardTitle>
              </CardHeader>
            </Card>
            <Card className="card-hover">
              <CardHeader className="pb-2">
                <CardDescription>{isRTL ? 'نجح' : 'Success'}</CardDescription>
                <CardTitle className="text-2xl text-emerald-500">{metricsQuery.data?.success_today ?? 0}</CardTitle>
              </CardHeader>
            </Card>
            <Card className="card-hover">
              <CardHeader className="pb-2">
                <CardDescription>{isRTL ? 'فشل' : 'Failed'}</CardDescription>
                <CardTitle className="text-2xl text-rose-500">{metricsQuery.data?.failed_today ?? 0}</CardTitle>
              </CardHeader>
            </Card>
          </div>
        </div>

        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Webhook className="h-5 w-5" />
                {t('seller.salla.settingsTitle')}
              </CardTitle>
              <CardDescription>{t('seller.salla.settingsHint')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <p className="text-sm font-medium">{t('seller.salla.enabled')}</p>
                  <p className="text-xs text-muted-foreground">{t('seller.salla.enabledHint')}</p>
                </div>
                <Switch checked={enabled} onCheckedChange={setEnabled} />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>{isRTL ? 'حالة الدفع' : 'Payment status'}</Label>
                  <Select value={paymentStatusFilter} onValueChange={(v) => setPaymentStatusFilter(v as 'all' | 'paid')}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{isRTL ? 'جميع الحالات' : 'All'}</SelectItem>
                      <SelectItem value="paid">{isRTL ? 'مدفوع فقط' : 'Paid only'}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t('seller.salla.eventTypeLabel')}</Label>
                  <div className="rounded-md border px-3 py-2 text-sm text-muted-foreground">{t('seller.salla.eventTypeValue')}</div>
                </div>
              </div>

              <div className="rounded-lg border p-3 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{t('seller.salla.duplicateDelayTitle')}</p>
                    <p className="text-xs text-muted-foreground">{t('seller.salla.duplicateDelayHint')}</p>
                  </div>
                  <Switch checked={duplicateDelayEnabled} onCheckedChange={setDuplicateDelayEnabled} />
                </div>

                <div className="space-y-2">
                  <Label>{t('seller.salla.duplicateDelayMinutes')}</Label>
                  <Input
                    type="number"
                    min={1}
                    max={10080}
                    disabled={!duplicateDelayEnabled}
                    value={duplicateDelayMinutes}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      if (!Number.isFinite(next)) return;
                      setDuplicateDelayMinutes(Math.max(1, Math.min(10080, Math.trunc(next))));
                    }}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
                <Button
                  type="button"
                  className={cn('gap-2 btn-primary', isRTL && 'flex-row-reverse')}
                  disabled={!connected || simulateMutation.isPending}
                  onClick={async () => {
                    try {
                      const res = await simulateMutation.mutateAsync();
                      toast({ title: t('common.success'), description: `${isRTL ? 'تم إنشاء اختبار' : 'Test created'}: ${res.salla_order_id}` });
                    } catch (e) {
                      const msg = e instanceof Error ? e.message : t('common.error');
                      toast({ title: t('common.error'), description: msg });
                    }
                  }}
                >
                  <Webhook className="h-4 w-4" />
                  {isRTL ? 'اختبار Webhook' : 'Test webhook'}
                </Button>

                <div className="flex gap-2">
                  {isManual ? (
                    <Button
                      type="button"
                      variant="outline"
                      className={cn('gap-2', isRTL && 'flex-row-reverse')}
                      disabled={rotateMutation.isPending}
                      onClick={async () => {
                        try {
                          const existing = status?.connected;
                          const delaySeconds = duplicateDelayEnabled ? Math.max(1, Math.round(duplicateDelayMinutes)) * 60 : 0;
                          const res = existing
                            ? await rotateMutation.mutateAsync()
                            : await sellerSallaApi.rotateTokenWithConfig({
                                is_enabled: enabled,
                                payment_status_filter: paymentStatusFilter,
                                duplicate_link_delay_seconds: delaySeconds,
                              });
                          setNewToken(res.token);
                          await queryClient.invalidateQueries({ queryKey: ['seller', 'salla'] });
                          toast({ title: t('common.success'), description: t('seller.salla.toasts.tokenRotated') });
                        } catch (e) {
                          const msg = e instanceof Error ? e.message : t('common.error');
                          toast({ title: t('common.error'), description: msg });
                        }
                      }}
                    >
                      <RefreshCcw className="h-4 w-4" />
                      {t('seller.salla.rotateToken')}
                    </Button>
                  ) : null}

                  <Button onClick={save} disabled={saveMutation.isPending}>
                    {t('common.save')}
                  </Button>
                </div>
              </div>

              {newToken && (
                <div className="rounded-lg border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">{t('seller.salla.newTokenTitle')}</p>
                      <p className="text-xs text-muted-foreground">{t('seller.salla.newTokenHint')}</p>
                    </div>
                    <Button type="button" size="sm" variant="outline" className={cn('gap-2', isRTL && 'flex-row-reverse')} onClick={() => copy(newToken)}>
                      <Copy className="h-4 w-4" />
                      {t('common.copy')}
                    </Button>
                  </div>
                  <Input className="mt-3 font-mono" readOnly value={newToken} />
                </div>
              )}

              {isManual && connected && (
                <div className="rounded-lg border p-3 space-y-3">
                  <div>
                    <p className="text-sm font-medium">{t('seller.salla.webhookTitle')}</p>
                    <p className="text-xs text-muted-foreground">{t('seller.salla.webhookHint')}</p>
                  </div>

                  {webhookInfoQuery.data?.webhook_url && (
                    <div className="space-y-2">
                      <Label>{t('seller.salla.webhookUrl')}</Label>
                      <div className="flex gap-2">
                        <Input readOnly value={webhookInfoQuery.data.webhook_url} className="font-mono" />
                        <Button type="button" variant="outline" className="gap-2" onClick={() => copy(webhookInfoQuery.data!.webhook_url)}>
                          <Copy className="h-4 w-4" />
                          {t('common.copy')}
                        </Button>
                      </div>
                    </div>
                  )}

                  {!!headersText && (
                    <div className="space-y-2">
                      <Label>{t('seller.salla.headersTitle')}</Label>
                      <div className="flex gap-2">
                        <Textarea readOnly value={headersText} className="min-h-[88px] font-mono" />
                        <Button type="button" variant="outline" className="gap-2" onClick={() => copy(headersText)}>
                          <Copy className="h-4 w-4" />
                          {t('common.copy')}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Download className="h-5 w-5" />
                {isRTL ? 'النشاط الأخير' : 'Recent activity'}
              </CardTitle>
              <CardDescription>{isRTL ? 'آخر الطلبات التي وصلت من سلة.' : 'Latest orders received from Salla.'}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {(recentQuery.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">{isRTL ? 'لا يوجد نشاط بعد.' : 'No activity yet.'}</p>
              ) : (
                <div className="space-y-2">
                  {(recentQuery.data ?? []).map((o) => (
                    <div key={o.salla_order_id} className="flex items-center justify-between rounded-lg border p-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{o.salla_order_id}</p>
                        <p className="text-xs text-muted-foreground">{new Date(o.updated_at).toLocaleString()}</p>
                        {o.fulfillments.failed > 0 && o.fulfillments.last_error && (
                          <p className="mt-1 line-clamp-2 text-xs text-rose-300">{o.fulfillments.last_error}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {o.fulfillments.failed > 0 ? (
                          <Badge variant="secondary" className="bg-rose-500/10 text-rose-400">{isRTL ? 'فشل' : 'Failed'}</Badge>
                        ) : o.fulfillments.pending > 0 ? (
                          <Badge variant="secondary" className="bg-amber-500/10 text-amber-400">{isRTL ? 'قيد المعالجة' : 'Pending'}</Badge>
                        ) : (
                          <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-400">{isRTL ? 'نجح' : 'Success'}</Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
