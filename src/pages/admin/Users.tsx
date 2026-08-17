import { useTranslation } from 'react-i18next';
import { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
import { useAdminUsers, useUpdateAdminUser, useDeleteAdminUser, useResetAdminUserPassword } from '@/hooks/useApi';
import type { AdminUser } from '@/api/adminUsers';
import { useAuthStore } from '@/store';
import { toast } from '@/hooks/use-toast';

function diffDaysCeil(fromIso: string, toIso: string) {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  const diff = to - from;
  const days = Math.ceil(diff / (24 * 60 * 60 * 1000));
  return days > 0 ? days : 0;
}

function getSubscriptionRemainingLabel(
  t: (key: string, options?: Record<string, unknown>) => string,
  renewAt: string | null | undefined,
) {
  if (!renewAt) return t('admin.usersSubscriptionNoRenewal');

  const now = Date.now();
  const renewMs = Date.parse(renewAt);
  if (!Number.isFinite(renewMs)) return t('admin.usersSubscriptionNoRenewal');

  const diffMs = renewMs - now;
  if (diffMs <= 0) return t('admin.usersSubscriptionExpired');

  const minuteMs = 60 * 1000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;

  if (diffMs >= dayMs) {
    return t('admin.usersSubscriptionRemainingDays', { count: Math.ceil(diffMs / dayMs) });
  }
  if (diffMs >= hourMs) {
    return t('admin.usersSubscriptionRemainingHours', { count: Math.ceil(diffMs / hourMs) });
  }
  return t('admin.usersSubscriptionRemainingMinutes', { count: Math.max(1, Math.ceil(diffMs / minuteMs)) });
}

export default function AdminUsersPage() {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<AdminUser | null>(null);
  const [subscriptionDays, setSubscriptionDays] = useState<number>(30);
  const [passwordId, setPasswordId] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { user: currentUser } = useAuthStore();
  const usersQuery = useAdminUsers({ q: query });
  const updateUser = useUpdateAdminUser();
  const deleteUser = useDeleteAdminUser();
  const resetPassword = useResetAdminUserPassword();

  const users = usersQuery.data?.data ?? [];
  const passwordUser = users.find((u) => u.id === passwordId) ?? null;

  const filtered = useMemo(() => {
    if (!query.trim()) return users;
    const q = query.trim().toLowerCase();
    return users.filter((u) => `${u.name} ${u.email} ${u.role}`.toLowerCase().includes(q));
  }, [users, query]);

  const handleSave = async () => {
    if (!editForm) return;
    updateUser.mutate({
      id: editForm.id,
      input: {
        name: editForm.name,
        email: editForm.email,
        role: editForm.role,
        phone: editForm.phone ?? null,
        subscriptionPlan: (editForm.subscription?.plan as any) ?? undefined,
        subscriptionDays,
        isDisabled: editForm.isDisabled ?? false,
        emailVerified: editForm.emailVerified,
      },
    });
    setEditingId(null);
    setEditForm(null);
  };

  const handlePasswordReset = async () => {
    if (!passwordUser) return;
    resetPassword.mutate({ id: passwordUser.id, password });
    setPassword('');
    setPasswordId(null);
  };

  const userToDelete = deleteId ? users.find((u) => u.id === deleteId) ?? null : null;
  const confirmDelete = async () => {
    if (!deleteId) return;
    if (currentUser?.id && currentUser.id === deleteId) {
      toast({ title: t('common.error'), description: t('admin.usersDeleteSelfError') });
      setDeleteId(null);
      return;
    }
    try {
      await deleteUser.mutateAsync(deleteId);
      toast({ title: t('common.success'), description: t('admin.usersDeleted') });
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
        <h1 className="text-2xl font-bold">{t('admin.users')}</h1>
        <p className="text-sm text-muted-foreground">{t('admin.usersSubtitle')}</p>
      </div>
      <Card>
        <CardHeader className="gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>{t('admin.users')}</CardTitle>
            <CardDescription>{t('admin.usersHint')}</CardDescription>
          </div>
          <Input
            className="w-full sm:w-72"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('common.search')}
          />
        </CardHeader>
        <CardContent className="space-y-3">
          {usersQuery.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('common.empty')}</p>
          ) : (
            filtered.map((user) => (
              <div key={user.id} className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{user.name}</p>
                  <p className="text-xs text-muted-foreground">{user.email}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{user.role}</Badge>
                  {user.isDisabled ? <Badge variant="destructive">{t('admin.usersDisabled')}</Badge> : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setEditingId(user.id);
                      setEditForm({ ...user });
                      const now = new Date().toISOString();
                      const renewAt = user.subscription?.renewAt;
                      const inferred = renewAt ? diffDaysCeil(now, renewAt) : null;
                      setSubscriptionDays(inferred && inferred > 0 ? inferred : 30);
                    }}
                  >
                    {t('common.edit')}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setPasswordId(user.id)}>
                    {t('admin.usersResetPassword')}
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => setDeleteId(user.id)}>
                    {t('common.delete')}
                  </Button>
                </div>
                <div className="rounded-lg border border-dashed px-3 py-2 text-sm sm:min-w-40">
                  <p className="text-[11px] text-muted-foreground">{t('admin.usersSubscriptionRemaining')}</p>
                  <p className="mt-1 font-medium">
                    {getSubscriptionRemainingLabel(t, user.subscription?.renewAt)}
                  </p>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!deleteId} onOpenChange={(open) => { if (!open) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('admin.usersDeleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('admin.usersDeleteDescription', { email: userToDelete?.email ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteUser.isPending}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={deleteUser.isPending}>
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={!!editForm}
        onOpenChange={() => {
          setEditingId(null);
          setEditForm(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.usersEdit')}</DialogTitle>
          </DialogHeader>
          {editForm ? (
            <div className="space-y-4">
              <div>
                <Label>{t('auth.register.name')}</Label>
                <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
              </div>
              <div>
                <Label>{t('auth.login.email')}</Label>
                <Input value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
              </div>
              <div>
                <Label>{t('admin.usersRole')}</Label>
                <Select value={editForm.role} onValueChange={(v) => setEditForm({ ...editForm, role: v as any })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="seller">seller</SelectItem>
                    <SelectItem value="admin">admin</SelectItem>
                    <SelectItem value="user">user</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t('admin.usersSubscriptionPlan')}</Label>
                <Select
                  value={(editForm.subscription?.plan as any) ?? 'basic'}
                  onValueChange={(v) => setEditForm({ ...editForm, subscription: { ...(editForm.subscription ?? { status: 'active', renewAt: null }), plan: v } })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="basic">basic</SelectItem>
                    <SelectItem value="plus">plus</SelectItem>
                    <SelectItem value="pro">pro</SelectItem>
                    <SelectItem value="special">special</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t('auth.register.phone')}</Label>
                <Input value={editForm.phone ?? ''} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
              </div>
              <div>
                <Label>{t('admin.usersSubscriptionDays')}</Label>
                <Input
                  type="number"
                  min={1}
                  max={3650}
                  value={subscriptionDays}
                  onChange={(e) => setSubscriptionDays(Number(e.target.value || 0))}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('admin.usersSubscriptionRenewAt', { date: editForm.subscription?.renewAt ? new Date(editForm.subscription.renewAt).toLocaleDateString() : '—' })}
                </p>
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <p className="text-sm font-medium">{t('admin.usersDisabled')}</p>
                  <p className="text-xs text-muted-foreground">{t('admin.usersDisabledHint')}</p>
                </div>
                <Switch checked={!!editForm.isDisabled} onCheckedChange={(v) => setEditForm({ ...editForm, isDisabled: v })} />
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <p className="text-sm font-medium">{t('admin.usersEmailVerified')}</p>
                </div>
                <Switch checked={!!editForm.emailVerified} onCheckedChange={(v) => setEditForm({ ...editForm, emailVerified: v })} />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="secondary" onClick={() => { setEditingId(null); setEditForm(null); }}>{t('common.cancel')}</Button>
            <Button onClick={handleSave} disabled={updateUser.isPending}>{t('common.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!passwordUser} onOpenChange={() => setPasswordId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.usersResetPassword')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Label>{t('auth.login.password')}</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setPasswordId(null)}>{t('common.cancel')}</Button>
            <Button onClick={handlePasswordReset} disabled={resetPassword.isPending || !password}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
