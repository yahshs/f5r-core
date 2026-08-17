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
import { useAdminCategories, useCreateAdminCategory, useUpdateAdminCategory, useDeleteAdminCategory } from '@/hooks/useApi';
import type { AdminCategory } from '@/api/adminCategories';

export default function AdminCategoriesPage() {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [editForm, setEditForm] = useState<AdminCategory | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: '',
    name_ar: '',
    slug: '',
    platform: 'instagram',
    icon: 'hash',
    description: '',
    description_ar: '',
    enabled: true,
    sort_order: 0,
  });

  const categoriesQuery = useAdminCategories();
  const createCategory = useCreateAdminCategory();
  const updateCategory = useUpdateAdminCategory();
  const deleteCategory = useDeleteAdminCategory();
  const categories = categoriesQuery.data?.data ?? [];

  const filtered = useMemo(() => {
    if (!query.trim()) return categories;
    const q = query.trim().toLowerCase();
    return categories.filter((c) => `${c.name} ${c.slug} ${c.platform}`.toLowerCase().includes(q));
  }, [categories, query]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('admin.categories')}</h1>
          <p className="text-sm text-muted-foreground">{t('admin.categoriesSubtitle')}</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>{t('admin.categoriesCreate')}</Button>
      </div>
      <Card>
        <CardHeader className="gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>{t('admin.categories')}</CardTitle>
            <CardDescription>{t('admin.categoriesHint')}</CardDescription>
          </div>
          <Input className="w-full sm:w-72" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('common.search')} />
        </CardHeader>
        <CardContent className="space-y-3">
          {categoriesQuery.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('common.empty')}</p>
          ) : (
            filtered.map((category) => (
              <div key={category.id} className="flex flex-col gap-2 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{category.name}</p>
                  <p className="text-xs text-muted-foreground">{category.slug}</p>
                  <p className="text-xs text-muted-foreground">{category.platform}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{category.enabled ? t('common.active') : t('common.inactive')}</Badge>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setEditForm({ ...category })}>
                    {t('common.edit')}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      const ok = window.confirm(t('admin.categoriesDeleteConfirm'));
                      if (!ok) return;
                      deleteCategory.mutate(category.id);
                    }}
                  >
                    {t('common.delete')}
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editForm} onOpenChange={() => setEditForm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.categoriesEdit')}</DialogTitle>
          </DialogHeader>
          {editForm ? (
            <div className="space-y-3">
              <div>
                <Label>{t('admin.categoriesName')}</Label>
                <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
              </div>
              <div>
                <Label>{t('admin.categoriesNameAr')}</Label>
                <Input value={editForm.name_ar} onChange={(e) => setEditForm({ ...editForm, name_ar: e.target.value })} />
              </div>
              <div>
                <Label>{t('admin.categoriesSlug')}</Label>
                <Input value={editForm.slug} onChange={(e) => setEditForm({ ...editForm, slug: e.target.value })} />
              </div>
              <div>
                <Label>{t('admin.categoriesPlatform')}</Label>
                <Input value={editForm.platform} onChange={(e) => setEditForm({ ...editForm, platform: e.target.value })} />
              </div>
              <div>
                <Label>{t('admin.categoriesIcon')}</Label>
                <Input value={editForm.icon} onChange={(e) => setEditForm({ ...editForm, icon: e.target.value })} />
              </div>
              <div>
                <Label>{t('admin.categoriesDescription')}</Label>
                <Input value={editForm.description ?? ''} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} />
              </div>
              <div>
                <Label>{t('admin.categoriesDescriptionAr')}</Label>
                <Input value={editForm.description_ar ?? ''} onChange={(e) => setEditForm({ ...editForm, description_ar: e.target.value })} />
              </div>
              <div>
                <Label>{t('admin.categoriesSort')}</Label>
                <Input type="number" value={editForm.sort_order} onChange={(e) => setEditForm({ ...editForm, sort_order: Number(e.target.value) })} />
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <p className="text-sm font-medium">{t('common.active')}</p>
                </div>
                <Switch checked={!!editForm.enabled} onCheckedChange={(v) => setEditForm({ ...editForm, enabled: v ? 1 : 0 })} />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setEditForm(null)}>{t('common.cancel')}</Button>
            <Button
              onClick={() => {
                if (!editForm) return;
                updateCategory.mutate({
                  id: editForm.id,
                  input: {
                    name: editForm.name,
                    name_ar: editForm.name_ar,
                    slug: editForm.slug,
                    platform: editForm.platform,
                    icon: editForm.icon,
                    description: editForm.description,
                    description_ar: editForm.description_ar,
                    sort_order: editForm.sort_order,
                    enabled: !!editForm.enabled,
                  },
                });
                setEditForm(null);
              }}
              disabled={updateCategory.isPending}
            >
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.categoriesCreate')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>{t('admin.categoriesName')}</Label>
              <Input value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} />
            </div>
            <div>
              <Label>{t('admin.categoriesNameAr')}</Label>
              <Input value={createForm.name_ar} onChange={(e) => setCreateForm({ ...createForm, name_ar: e.target.value })} />
            </div>
            <div>
              <Label>{t('admin.categoriesSlug')}</Label>
              <Input value={createForm.slug} onChange={(e) => setCreateForm({ ...createForm, slug: e.target.value })} />
            </div>
            <div>
              <Label>{t('admin.categoriesPlatform')}</Label>
              <Input value={createForm.platform} onChange={(e) => setCreateForm({ ...createForm, platform: e.target.value })} />
            </div>
            <div>
              <Label>{t('admin.categoriesIcon')}</Label>
              <Input value={createForm.icon} onChange={(e) => setCreateForm({ ...createForm, icon: e.target.value })} />
            </div>
            <div>
              <Label>{t('admin.categoriesDescription')}</Label>
              <Input value={createForm.description} onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })} />
            </div>
            <div>
              <Label>{t('admin.categoriesDescriptionAr')}</Label>
              <Input value={createForm.description_ar} onChange={(e) => setCreateForm({ ...createForm, description_ar: e.target.value })} />
            </div>
            <div>
              <Label>{t('admin.categoriesSort')}</Label>
              <Input type="number" value={createForm.sort_order} onChange={(e) => setCreateForm({ ...createForm, sort_order: Number(e.target.value) })} />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">{t('common.active')}</p>
              </div>
              <Switch checked={createForm.enabled} onCheckedChange={(v) => setCreateForm({ ...createForm, enabled: v })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>{t('common.cancel')}</Button>
            <Button
              onClick={() => {
                createCategory.mutate({
                  name: createForm.name,
                  name_ar: createForm.name_ar,
                  slug: createForm.slug,
                  platform: createForm.platform,
                  icon: createForm.icon,
                  description: createForm.description || null,
                  description_ar: createForm.description_ar || null,
                  enabled: createForm.enabled,
                  sort_order: createForm.sort_order,
                });
                setCreateOpen(false);
                setCreateForm({
                  name: '',
                  name_ar: '',
                  slug: '',
                  platform: 'instagram',
                  icon: 'hash',
                  description: '',
                  description_ar: '',
                  enabled: true,
                  sort_order: 0,
                });
              }}
              disabled={createCategory.isPending}
            >
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
