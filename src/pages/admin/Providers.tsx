import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAdminProviders, useUpdateAdminProvider, useDeleteAdminProvider } from '@/hooks/useApi';
import type { AdminProvider } from '@/api/adminProviders';
import { toast } from '@/hooks/use-toast';

export default function AdminProvidersPage() {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [editForm, setEditForm] = useState<AdminProvider | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const providersQuery = useAdminProviders();
  const updateProvider = useUpdateAdminProvider();
  const deleteProvider = useDeleteAdminProvider();
  const providers = providersQuery.data?.data ?? [];
  const providerToDelete = deleteId ? providers.find((p) => p.id === deleteId) ?? null : null;

  const filtered = useMemo(() => {
    if (!query.trim()) return providers;
    const q = query.trim().toLowerCase();
    return providers.filter((p) => `${p.name} ${p.base_url} ${p.seller_email ?? ''}`.toLowerCase().includes(q));
  }, [providers, query]);

  const confirmDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteProvider.mutateAsync(deleteId);
      toast({ title: t('common.success'), description: t('admin.providersDeleted') });
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('common.error');
      toast({ title: t('common.error'), description: msg });
    } finally {
      setDeleteId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('admin.providers')}</h1>
        <p className="text-sm text-muted-foreground">{t('admin.providersSubtitle')}</p>
      </div>
      <Card>
        <CardHeader className="gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>{t('admin.providers')}</CardTitle>
            <CardDescription>{t('admin.providersHint')}</CardDescription>
          </div>
          <Input className="w-full sm:w-72" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('common.search')} />
        </CardHeader>
        <CardContent className="space-y-3">
          {providersQuery.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('common.empty')}</p>
          ) : (
            filtered.map((provider) => (
              <div key={provider.id} className="flex flex-col gap-2 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{provider.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{provider.base_url}</p>
                  <p className="text-xs text-muted-foreground">{provider.seller_email ?? '-'}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{provider.is_active ? t('common.active') : t('common.inactive')}</Badge>
                  {provider.is_default ? <Badge>{t('admin.providersDefault')}</Badge> : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setEditForm({ ...provider })}>
                    {t('common.edit')}
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => setDeleteId(provider.id)}>
                    {t('common.delete')}
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!deleteId} onOpenChange={(open) => { if (!open) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('admin.providersDeleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('admin.providersDeleteDescription', { name: providerToDelete?.name ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteProvider.isPending}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={deleteProvider.isPending}>
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!editForm} onOpenChange={() => setEditForm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.providersEdit')}</DialogTitle>
          </DialogHeader>
          {editForm ? (
            <div className="space-y-4">
              <div>
                <Label>{t('seller.smmProviders.fields.name')}</Label>
                <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
              </div>
              <div>
                <Label>{t('seller.smmProviders.fields.baseUrl')}</Label>
                <Input value={editForm.base_url} onChange={(e) => setEditForm({ ...editForm, base_url: e.target.value })} />
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <p className="text-sm font-medium">{t('common.active')}</p>
                  <p className="text-xs text-muted-foreground">{t('admin.providersActiveHint')}</p>
                </div>
                <Switch checked={!!editForm.is_active} onCheckedChange={(v) => setEditForm({ ...editForm, is_active: v ? 1 : 0 })} />
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <p className="text-sm font-medium">{t('admin.providersDefault')}</p>
                  <p className="text-xs text-muted-foreground">{t('admin.providersDefaultHint')}</p>
                </div>
                <Switch checked={!!editForm.is_default} onCheckedChange={(v) => setEditForm({ ...editForm, is_default: v ? 1 : 0 })} />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setEditForm(null)}>{t('common.cancel')}</Button>
            <Button
              onClick={() => {
                if (!editForm) return;
                updateProvider.mutate({
                  id: editForm.id,
                  input: {
                    name: editForm.name,
                    base_url: editForm.base_url,
                    is_active: !!editForm.is_active,
                    is_default: !!editForm.is_default,
                  },
                });
                setEditForm(null);
              }}
              disabled={updateProvider.isPending}
            >
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
