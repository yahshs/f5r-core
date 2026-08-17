import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Plus, Pencil, Trash2, PlugZap, CheckCircle2, XCircle, Star } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { SmmProviderConnection } from '@/types';
import { maskApiKey } from '@/utils/mask';
import { useCreateSellerSmmProvider, useDeleteSellerSmmProvider, useSellerSmmProviders, useTestSellerSmmProvider, useUpdateSellerSmmProvider } from '@/hooks/useApi';

const baseSchema = z.object({
  name: z.string().trim().min(1),
  base_url: z.string().trim().url(),
  api_key: z.string().optional(),
  cost_currency: z.preprocess(
    (val) => (typeof val === 'string' && !val.trim().length ? null : val),
    z.string().trim().min(1).max(24).optional().nullable(),
  ),
  fx_rate_to_store: z.preprocess(
    (val) => (val === '' || val === null || val === undefined ? null : val),
    z.coerce.number().gt(0).max(1000).optional().nullable(),
  ),
  low_balance_threshold: z.preprocess(
    (val) => (val === '' || val === null || val === undefined ? null : val),
    z.coerce.number().gte(0).max(1_000_000).optional().nullable(),
  ),
  is_active: z.boolean().default(true),
  is_default: z.boolean().default(false),
});

type FormValues = z.infer<typeof baseSchema>;

function statusBadge(t: (key: string) => string, provider: SmmProviderConnection) {
  return provider.is_active ? (
    <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
      {t('seller.smmProviders.badges.active')}
    </Badge>
  ) : (
    <Badge variant="secondary" className="bg-rose-500/10 text-rose-700 dark:text-rose-400">
      {t('seller.smmProviders.badges.inactive')}
    </Badge>
  );
}

function testBadge(t: (key: string) => string, provider: SmmProviderConnection) {
  if (!provider.last_test_status) {
    return <Badge variant="outline">—</Badge>;
  }
  return provider.last_test_status === 'SUCCESS' ? (
    <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
      <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> {t('seller.smmProviders.badges.testSuccess')}
    </Badge>
  ) : (
    <Badge variant="secondary" className="bg-rose-500/10 text-rose-700 dark:text-rose-400">
      <XCircle className="mr-1 h-3.5 w-3.5" /> {t('seller.smmProviders.badges.testFail')}
    </Badge>
  );
}

function ProviderModal(props: {
  mode: 'create' | 'edit';
  provider?: SmmProviderConnection | null;
  onSubmit: (values: FormValues) => Promise<void>;
  trigger: React.ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const { mode, provider } = props;
  const [open, setOpen] = useState(false);
  const isRTL = i18n.language === 'ar';

  const schema = useMemo(() => {
    if (mode === 'create') {
      return baseSchema.extend({ api_key: z.string().min(1) });
    }
    return baseSchema;
  }, [mode]);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: provider?.name ?? '',
      base_url: provider?.base_url ?? '',
      api_key: '',
      cost_currency: provider?.cost_currency ?? null,
      fx_rate_to_store: provider?.fx_rate_to_store ?? 1,
      low_balance_threshold: provider?.low_balance_threshold ?? null,
      is_active: provider?.is_active ?? true,
      is_default: provider?.is_default ?? false,
    },
  });

  useEffect(() => {
    form.reset({
      name: provider?.name ?? '',
      base_url: provider?.base_url ?? '',
      api_key: '',
      cost_currency: provider?.cost_currency ?? null,
      fx_rate_to_store: provider?.fx_rate_to_store ?? 1,
      low_balance_threshold: provider?.low_balance_threshold ?? null,
      is_active: provider?.is_active ?? true,
      is_default: provider?.is_default ?? false,
    });
  }, [provider, open, form]);

  const handleSubmit = form.handleSubmit(async (values) => {
    await props.onSubmit(values);
    setOpen(false);
    form.reset();
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{props.trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {mode === 'create' ? t('seller.smmProviders.addTitle') : t('seller.smmProviders.editTitle')}
          </DialogTitle>
          <DialogDescription>{t('seller.smmProviders.detailsHint')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">{t('seller.smmProviders.fields.name')}</Label>
            <Input id="name" {...form.register('name')} placeholder={t('seller.smmProviders.placeholders.name')} />
            {form.formState.errors.name?.message && (
              <p className="text-sm text-destructive">{String(form.formState.errors.name.message)}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="base_url">{t('seller.smmProviders.fields.baseUrl')}</Label>
            <Input id="base_url" {...form.register('base_url')} placeholder={t('seller.smmProviders.placeholders.baseUrl')} />
            {form.formState.errors.base_url?.message && (
              <p className="text-sm text-destructive">{String(form.formState.errors.base_url.message)}</p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="cost_currency">{t('seller.smmProviders.fields.costCurrency', { defaultValue: 'Provider cost currency (optional)' })}</Label>
              <Input id="cost_currency" {...form.register('cost_currency')} placeholder="USD" dir="ltr" />
              {form.formState.errors.cost_currency?.message && (
                <p className="text-sm text-destructive">{String(form.formState.errors.cost_currency.message)}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="fx_rate_to_store">{t('seller.smmProviders.fields.fxRate', { defaultValue: 'FX rate to store currency' })}</Label>
              <Input
                id="fx_rate_to_store"
                type="number"
                step="0.0001"
                inputMode="decimal"
                {...form.register('fx_rate_to_store')}
                placeholder="1"
                dir="ltr"
              />
              {form.formState.errors.fx_rate_to_store?.message && (
                <p className="text-sm text-destructive">{String(form.formState.errors.fx_rate_to_store.message)}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="low_balance_threshold">
              {t('seller.smmProviders.fields.lowBalanceThreshold', { defaultValue: 'Telegram low-balance threshold' })}
            </Label>
            <Input
              id="low_balance_threshold"
              type="number"
              step="0.01"
              inputMode="decimal"
              {...form.register('low_balance_threshold')}
              placeholder="0"
              dir="ltr"
            />
            <p className="text-xs text-muted-foreground">
              {t('seller.smmProviders.hints.lowBalanceThreshold', {
                defaultValue: 'When balance drops below this value, Telegram sends an alert. Leave empty to disable.',
              })}
            </p>
            {form.formState.errors.low_balance_threshold?.message && (
              <p className="text-sm text-destructive">{String(form.formState.errors.low_balance_threshold.message)}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="api_key">{t('seller.smmProviders.fields.apiKey')}</Label>
            <Input
              id="api_key"
              type="password"
              {...form.register('api_key')}
              placeholder={mode === 'edit' ? t('seller.smmProviders.placeholders.apiKeyEdit') : t('seller.smmProviders.placeholders.apiKey')}
              autoComplete="off"
            />
            {form.formState.errors.api_key?.message && (
              <p className="text-sm text-destructive">{String(form.formState.errors.api_key.message)}</p>
            )}
            {mode === 'edit' && provider?.api_key_last4 && (
              <p className="text-xs text-muted-foreground">
                {t('seller.smmProviders.currentKey')}: {maskApiKey(provider.api_key_last4)}
              </p>
            )}
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">{t('seller.smmProviders.fields.active')}</p>
              <p className="text-xs text-muted-foreground">{t('seller.smmProviders.hints.active')}</p>
            </div>
            <Switch checked={form.watch('is_active')} onCheckedChange={(v) => form.setValue('is_active', v)} />
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">{t('seller.smmProviders.fields.default')}</p>
              <p className="text-xs text-muted-foreground">{t('seller.smmProviders.hints.default')}</p>
            </div>
            <Switch checked={form.watch('is_default')} onCheckedChange={(v) => form.setValue('is_default', v)} />
          </div>

          <DialogFooter>
            {isRTL ? (
              <>
                <Button type="submit" disabled={form.formState.isSubmitting}>
                  {t('common.save')}
                </Button>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  {t('common.cancel')}
                </Button>
              </>
            ) : (
              <>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  {t('common.cancel')}
                </Button>
                <Button type="submit" disabled={form.formState.isSubmitting}>
                  {t('common.save')}
                </Button>
              </>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function SellerSmmProvidersPage() {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const listQuery = useSellerSmmProviders();
  const createMutation = useCreateSellerSmmProvider();
  const updateMutation = useUpdateSellerSmmProvider();
  const deleteMutation = useDeleteSellerSmmProvider();
  const testMutation = useTestSellerSmmProvider();

  const providers = listQuery.data ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedId && providers.length) setSelectedId(providers[0].id);
    if (selectedId && providers.length && !providers.some((p) => p.id === selectedId)) {
      setSelectedId(providers[0].id);
    }
  }, [providers, selectedId]);

  const selected = providers.find((p) => p.id === selectedId) || null;

  const handleCreate = async (values: FormValues) => {
    try {
      const provider = await createMutation.mutateAsync({
        name: values.name,
        base_url: values.base_url,
        api_key: values.api_key || '',
        cost_currency: values.cost_currency ?? null,
        fx_rate_to_store: values.fx_rate_to_store ?? null,
        low_balance_threshold: values.low_balance_threshold ?? null,
        is_active: values.is_active,
        is_default: values.is_default,
      });
      toast({ title: t('common.success'), description: t('seller.smmProviders.toasts.created') });
      setSelectedId(provider.id);
    } catch (e: any) {
      toast({ title: t('common.error'), description: e.message, variant: 'destructive' });
    }
  };

  const handleEdit = async (providerId: string, values: FormValues) => {
    try {
      const input: any = {
        name: values.name,
        base_url: values.base_url,
        is_active: values.is_active,
        is_default: values.is_default,
        cost_currency: values.cost_currency ?? null,
        fx_rate_to_store: values.fx_rate_to_store ?? null,
        low_balance_threshold: values.low_balance_threshold ?? null,
      };
      if (values.api_key && values.api_key.trim().length) input.api_key = values.api_key;
      await updateMutation.mutateAsync({ id: providerId, input });
      toast({ title: t('common.success'), description: t('seller.smmProviders.toasts.updated') });
    } catch (e: any) {
      toast({ title: t('common.error'), description: e.message, variant: 'destructive' });
    }
  };

  const handleDelete = async (providerId: string) => {
    try {
      await deleteMutation.mutateAsync(providerId);
      toast({ title: t('common.success'), description: t('seller.smmProviders.toasts.deleted') });
    } catch (e: any) {
      toast({ title: t('common.error'), description: e.message, variant: 'destructive' });
    }
  };

  const handleTest = async () => {
    if (!selected) return;
    try {
      const res = await testMutation.mutateAsync(selected.id);
      toast({ title: t('seller.smmProviders.toasts.testedTitle'), description: res.message });
    } catch (e: any) {
      toast({ title: t('seller.smmProviders.toasts.testFailedTitle'), description: e.message, variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('seller.smmProviders.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('seller.smmProviders.subtitle')}</p>
        </div>
        <ProviderModal
          mode="create"
          onSubmit={handleCreate}
          trigger={
            <Button className="gap-2">
              {isRTL ? (
                <>
                  {t('seller.smmProviders.add')}
                  <Plus className="h-4 w-4" />
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4" />
                  {t('seller.smmProviders.add')}
                </>
              )}
            </Button>
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Connection Status */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>{t('seller.smmProviders.connectionStatus')}</CardTitle>
            <CardDescription>{t('seller.smmProviders.connectionStatusHint')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button
              className="w-full gap-2"
              onClick={handleTest}
              disabled={!selected || testMutation.isPending}
            >
              {isRTL ? (
                <>
                  {t('seller.smmProviders.testConnection')}
                  <PlugZap className="h-4 w-4" />
                </>
              ) : (
                <>
                  <PlugZap className="h-4 w-4" />
                  {t('seller.smmProviders.testConnection')}
                </>
              )}
            </Button>

            {!selected ? (
              <p className="text-sm text-muted-foreground">{t('seller.smmProviders.selectProvider')}</p>
            ) : (
              <div className="space-y-2 rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">{t('seller.smmProviders.lastResult')}</p>
                  {testBadge(t, selected)}
                </div>
                <p className="text-xs text-muted-foreground">{selected.last_test_message || '—'}</p>
                <p className="text-xs text-muted-foreground">
                  {t('seller.smmProviders.lastTestedAt')}: {selected.last_tested_at || '—'}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Provider Details + List */}
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>{t('seller.smmProviders.details')}</CardTitle>
              <CardDescription>{t('seller.smmProviders.detailsHint')}</CardDescription>
            </CardHeader>
            <CardContent>
              {listQuery.isLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-64" />
                </div>
              ) : !selected ? (
                <p className="text-sm text-muted-foreground">{t('seller.smmProviders.noSelection')}</p>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">{t('seller.smmProviders.fields.name')}</p>
                    <p className="text-sm font-medium">{selected.name}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">{t('seller.smmProviders.fields.status')}</p>
                    <div className="flex items-center gap-2">
                      {statusBadge(t, selected)}
                      {selected.is_default && (
                        <Badge variant="outline" className="gap-1">
                          <Star className="h-3.5 w-3.5" />
                          {t('seller.smmProviders.default')}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <p className="text-xs text-muted-foreground">{t('seller.smmProviders.fields.baseUrl')}</p>
                    <p className="break-all text-sm font-medium">{selected.base_url}</p>
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <p className="text-xs text-muted-foreground">{t('seller.smmProviders.fields.apiKey')}</p>
                    <p className="text-sm font-medium">
                      {maskApiKey(selected.api_key_last4 || '')}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">
                      {t('seller.smmProviders.fields.lowBalanceThreshold', { defaultValue: 'Telegram low-balance threshold' })}
                    </p>
                    <p className="text-sm">
                      {selected.low_balance_threshold ?? '—'}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">{t('seller.smmProviders.fields.createdAt')}</p>
                    <p className="text-sm">{selected.created_at}</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>{t('seller.smmProviders.listTitle')}</CardTitle>
                <CardDescription>{t('seller.smmProviders.listHint')}</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {listQuery.isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : providers.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('seller.smmProviders.empty')}</p>
              ) : (
                providers.map((p) => (
                  <div
                    key={p.id}
                    className={cn(
                      "flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between",
                      selectedId === p.id && "border-primary/50 bg-primary/5",
                    )}
                  >
                    <button
                      type="button"
                      className="text-left"
                      onClick={() => setSelectedId(p.id)}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium">{p.name}</p>
                        {p.is_default && (
                          <Badge variant="outline" className="gap-1">
                            <Star className="h-3.5 w-3.5" /> {t('seller.smmProviders.default')}
                          </Badge>
                        )}
                        {statusBadge(t, p)}
                        {testBadge(t, p)}
                      </div>
                      <p className="mt-1 max-w-[60ch] truncate text-sm text-muted-foreground">{p.base_url}</p>
                    </button>

                    <div className="flex items-center gap-2 sm:justify-end">
                      <ProviderModal
                        mode="edit"
                        provider={p}
                        onSubmit={(values) => handleEdit(p.id, values)}
                        trigger={
                          <Button variant="outline" size="sm" className="gap-2">
                            <Pencil className="h-4 w-4" />
                            {t('common.edit')}
                          </Button>
                        }
                      />

                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="destructive" size="sm" className="gap-2">
                            <Trash2 className="h-4 w-4" />
                            {t('common.delete')}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>{t('seller.smmProviders.deleteConfirmTitle')}</AlertDialogTitle>
                            <AlertDialogDescription>
                              {t('seller.smmProviders.deleteConfirmDesc')}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            {isRTL ? (
                              <>
                                <AlertDialogAction
                                  onClick={() => handleDelete(p.id)}
                                  className={cn("bg-destructive text-destructive-foreground hover:bg-destructive/90")}
                                >
                                  {t('common.delete')}
                                </AlertDialogAction>
                                <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                              </>
                            ) : (
                              <>
                                <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => handleDelete(p.id)}
                                  className={cn("bg-destructive text-destructive-foreground hover:bg-destructive/90")}
                                >
                                  {t('common.delete')}
                                </AlertDialogAction>
                              </>
                            )}
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
