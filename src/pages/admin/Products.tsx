import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useAdminProducts, useUpdateAdminProduct, useDeleteAdminProduct, useAdminProductRules, useUpdateAdminRule, useDeleteAdminRule } from '@/hooks/useApi';
import type { AdminProduct } from '@/api/adminProducts';
import type { SellerProductRule } from '@/api/sellerProducts';

export default function AdminProductsPage() {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<AdminProduct | null>(null);
  const [ruleForm, setRuleForm] = useState<SellerProductRule | null>(null);

  const productsQuery = useAdminProducts();
  const updateProduct = useUpdateAdminProduct();
  const deleteProduct = useDeleteAdminProduct();
  const updateRule = useUpdateAdminRule();
  const deleteRule = useDeleteAdminRule();

  const products = productsQuery.data?.data ?? [];
  const selected = products.find((p) => p.id === selectedId) ?? null;
  const rulesQuery = useAdminProductRules(selectedId);
  const rules = rulesQuery.data?.data ?? [];

  const filtered = useMemo(() => {
    if (!query.trim()) return products;
    const q = query.trim().toLowerCase();
    return products.filter((p) => `${p.name} ${p.salla_product_id ?? ''} ${p.sku ?? ''}`.toLowerCase().includes(q));
  }, [products, query]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('admin.products')}</h1>
        <p className="text-sm text-muted-foreground">{t('admin.productsSubtitle')}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>{t('admin.products')}</CardTitle>
            <CardDescription>{t('admin.productsHint')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('common.search')} />
            {productsQuery.isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('common.empty')}</p>
            ) : (
              filtered.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedId(p.id)}
                  className={`w-full rounded-lg border p-3 text-left transition ${selectedId === p.id ? 'border-primary' : 'hover:border-muted-foreground/30'}`}
                >
                  <p className="text-sm font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">{p.salla_product_id ?? '-'}</p>
                  <p className="text-xs text-muted-foreground">{p.seller_email ?? '-'}</p>
                </button>
              ))
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader className="gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle>{t('admin.productsDetails')}</CardTitle>
                <CardDescription>{t('admin.productsDetailsHint')}</CardDescription>
              </div>
              {selected ? (
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => setEditForm({ ...selected })}>{t('common.edit')}</Button>
                  <Button
                    variant="destructive"
                    onClick={() => {
                      const ok = window.confirm(t('admin.productsDeleteConfirm'));
                      if (!ok) return;
                      deleteProduct.mutate(selected.id);
                      setSelectedId(null);
                    }}
                  >
                    {t('common.delete')}
                  </Button>
                </div>
              ) : null}
            </CardHeader>
            <CardContent>
              {!selected ? (
                <p className="text-sm text-muted-foreground">{t('admin.productsSelect')}</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-xs text-muted-foreground">{t('seller.products.fields.name')}</p>
                    <p className="text-sm font-medium">{selected.name}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{t('seller.products.fields.sallaProductId')}</p>
                    <p className="text-sm font-medium">{selected.salla_product_id ?? '-'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{t('seller.products.fields.sku')}</p>
                    <p className="text-sm font-medium">{selected.sku ?? '-'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{t('seller.products.fields.handler')}</p>
                    <p className="text-sm font-medium">{selected.handler}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{t('seller.products.fields.category')}</p>
                    <p className="text-sm font-medium">{selected.category ?? '-'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{t('seller.products.fields.productType')}</p>
                    <p className="text-sm font-medium">{selected.product_type ?? '-'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{t('seller.products.fields.basePrice')}</p>
                    <p className="text-sm font-medium">{selected.base_price ?? '-'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{t('seller.products.fields.baseCost')}</p>
                    <p className="text-sm font-medium">{selected.base_cost ?? '-'}</p>
                  </div>
                  <div className="sm:col-span-2">
                    <p className="text-xs text-muted-foreground">{t('seller.products.fields.description')}</p>
                    <p className="text-sm font-medium">{selected.description ?? '-'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{t('common.status')}</p>
                    <Badge variant="outline">{selected.status}</Badge>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('admin.productsRules')}</CardTitle>
              <CardDescription>{t('admin.productsRulesHint')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {rulesQuery.isLoading ? (
                <Skeleton className="h-10 w-full" />
              ) : rules.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('common.empty')}</p>
              ) : (
                rules.map((r) => (
                  <div key={r.id} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-medium">{r.service_name}</p>
                      <p className="text-xs text-muted-foreground">#{r.provider_service_id}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{r.target_field}</Badge>
                      <Badge variant="outline">{r.quantity_type}</Badge>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button variant="secondary" size="sm" onClick={() => setRuleForm({ ...r })}>{t('common.edit')}</Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => {
                          const ok = window.confirm(t('admin.productsRuleDeleteConfirm'));
                          if (!ok) return;
                          deleteRule.mutate(r.id);
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
        </div>
      </div>

      <Dialog open={!!editForm} onOpenChange={() => setEditForm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.productsEdit')}</DialogTitle>
          </DialogHeader>
          {editForm ? (
            <div className="space-y-3">
              <div>
                <Label>{t('seller.products.fields.name')}</Label>
                <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
              </div>
              <div>
                <Label>{t('seller.products.fields.sallaProductId')}</Label>
                <Input value={editForm.salla_product_id ?? ''} onChange={(e) => setEditForm({ ...editForm, salla_product_id: e.target.value })} />
              </div>
              <div>
                <Label>{t('seller.products.fields.sku')}</Label>
                <Input value={editForm.sku ?? ''} onChange={(e) => setEditForm({ ...editForm, sku: e.target.value })} />
              </div>
              <div>
                <Label>{t('seller.products.fields.handler')}</Label>
                <Input value={editForm.handler} onChange={(e) => setEditForm({ ...editForm, handler: e.target.value })} />
              </div>
              <div>
                <Label>{t('seller.products.fields.productType')}</Label>
                <Input value={editForm.product_type ?? ''} onChange={(e) => setEditForm({ ...editForm, product_type: e.target.value })} />
              </div>
              <div>
                <Label>{t('seller.products.fields.category')}</Label>
                <Input value={editForm.category ?? ''} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })} />
              </div>
              <div>
                <Label>{t('seller.products.fields.basePrice')}</Label>
                <Input type="number" value={editForm.base_price ?? 0} onChange={(e) => setEditForm({ ...editForm, base_price: Number(e.target.value) })} />
              </div>
              <div>
                <Label>{t('seller.products.fields.baseCost')}</Label>
                <Input type="number" value={editForm.base_cost ?? 0} onChange={(e) => setEditForm({ ...editForm, base_cost: Number(e.target.value) })} />
              </div>
              <div>
                <Label>{t('seller.products.fields.description')}</Label>
                <Input value={editForm.description ?? ''} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} />
              </div>
              <div>
                <Label>{t('common.status')}</Label>
                <Select value={editForm.status} onValueChange={(v) => setEditForm({ ...editForm, status: v as any })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">active</SelectItem>
                    <SelectItem value="inactive">inactive</SelectItem>
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
                updateProduct.mutate({
                  id: editForm.id,
                  input: {
                    name: editForm.name,
                    salla_product_id: editForm.salla_product_id,
                    sku: editForm.sku,
                    handler: editForm.handler,
                    product_type: editForm.product_type,
                    category: editForm.category,
                    base_price: editForm.base_price,
                    base_cost: editForm.base_cost,
                    description: editForm.description,
                    status: editForm.status,
                  },
                });
                setEditForm(null);
              }}
              disabled={updateProduct.isPending}
            >
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!ruleForm} onOpenChange={() => setRuleForm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.productsRuleEdit')}</DialogTitle>
          </DialogHeader>
          {ruleForm ? (
            <div className="space-y-3">
              <div>
                <Label>{t('seller.products.rules.fields.serviceName')}</Label>
                <Input value={ruleForm.service_name} onChange={(e) => setRuleForm({ ...ruleForm, service_name: e.target.value })} />
              </div>
              <div>
                <Label>{t('seller.products.rules.fields.providerServiceId')}</Label>
                <Input type="number" value={ruleForm.provider_service_id} onChange={(e) => setRuleForm({ ...ruleForm, provider_service_id: Number(e.target.value) })} />
              </div>
              <div>
                <Label>{t('seller.products.rules.fields.targetField')}</Label>
                <Select value={ruleForm.target_field} onValueChange={(v) => setRuleForm({ ...ruleForm, target_field: v as any })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="link">link</SelectItem>
                    <SelectItem value="username">username</SelectItem>
                    <SelectItem value="post_link">post_link</SelectItem>
                    <SelectItem value="video_link">video_link</SelectItem>
                    <SelectItem value="custom">custom</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t('seller.products.rules.fields.quantityType')}</Label>
                <Select value={ruleForm.quantity_type} onValueChange={(v) => setRuleForm({ ...ruleForm, quantity_type: v as any })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixed">fixed</SelectItem>
                    <SelectItem value="from_field">from_field</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t('seller.products.rules.fields.quantityValue')}</Label>
                <Input type="number" value={ruleForm.quantity_value ?? 0} onChange={(e) => setRuleForm({ ...ruleForm, quantity_value: Number(e.target.value) })} />
              </div>
              <div>
                <Label>{t('seller.products.rules.fields.delaySeconds')}</Label>
                <Input type="number" value={ruleForm.delay_seconds ?? 0} onChange={(e) => setRuleForm({ ...ruleForm, delay_seconds: Number(e.target.value) })} />
              </div>
              <div>
                <Label>{t('seller.products.rules.fields.executionOrder')}</Label>
                <Input type="number" value={ruleForm.execution_order ?? 1} onChange={(e) => setRuleForm({ ...ruleForm, execution_order: Number(e.target.value) })} />
              </div>
              <div>
                <Label>{t('seller.products.rules.fields.normalizeUrl')}</Label>
                <Select value={ruleForm.normalize_url ? '1' : '0'} onValueChange={(v) => setRuleForm({ ...ruleForm, normalize_url: v === '1' })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">true</SelectItem>
                    <SelectItem value="0">false</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setRuleForm(null)}>{t('common.cancel')}</Button>
            <Button
              onClick={() => {
                if (!ruleForm) return;
                updateRule.mutate({
                  id: ruleForm.id,
                  input: {
                    service_name: ruleForm.service_name,
                    provider_service_id: ruleForm.provider_service_id,
                    target_field: ruleForm.target_field,
                    quantity_type: ruleForm.quantity_type,
                    quantity_value: ruleForm.quantity_value,
                    quantity_field: ruleForm.quantity_field,
                    delay_seconds: ruleForm.delay_seconds,
                    execution_order: ruleForm.execution_order,
                    normalize_url: ruleForm.normalize_url,
                    url_handler: ruleForm.url_handler,
                    provider_connection_id: ruleForm.provider_connection_id,
                    conditions: ruleForm.conditions,
                  },
                });
                setRuleForm(null);
              }}
              disabled={updateRule.isPending}
            >
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
