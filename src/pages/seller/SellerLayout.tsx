import { Link, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BarChart3, Bot, CreditCard, LayoutDashboard, Link2, Package, Server, ShoppingBag } from 'lucide-react';

import { MainLayout } from '@/components/layout';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store';

const sellerNavItems = [
  { path: '/seller/dashboard', icon: LayoutDashboard, labelKey: 'seller.nav.dashboard' },
  { path: '/seller/analytics', icon: BarChart3, labelKey: 'seller.nav.analytics' },
  { path: '/seller/orders', icon: Package, labelKey: 'seller.nav.orders' },
  { path: '/seller/products', icon: ShoppingBag, labelKey: 'seller.nav.products' },
  { path: '/seller/smm-providers', icon: Server, labelKey: 'seller.nav.smmProviders' },
  { path: '/seller/salla', icon: Link2, labelKey: 'seller.nav.salla' },
  { path: '/seller/compensation-bot', icon: Bot, labelKey: 'seller.nav.compensationBot' },
  { path: '/seller/account', icon: CreditCard, labelKey: 'seller.nav.account' },
];

export default function SellerLayout() {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const { user } = useAuthStore();
  const isRTL = i18n.dir() === 'rtl';

  const isActivePath = (path: string) => location.pathname === path || location.pathname.startsWith(`${path}/`);

  return (
    <MainLayout showFooter={false} className="dark bg-background text-foreground">
      <div className="f5r-workspace-bg min-h-[calc(100vh-4rem)] lg:flex">
        <aside
          className={cn(
            'hidden w-64 shrink-0 bg-[#0b0e0f]/90 backdrop-blur-2xl lg:sticky lg:top-16 lg:block lg:h-[calc(100vh-4rem)] lg:overflow-y-auto',
            isRTL ? 'border-l border-primary/10' : 'border-r border-primary/10',
          )}
        >
          <div className="flex min-h-full flex-col p-4 pb-5">
            <div className="mb-6 px-2 pt-1">
              <p className="text-sm font-semibold tracking-wide">F5R CORE</p>
              <p className="mt-1 text-xs text-muted-foreground">{t('seller.title')}</p>
            </div>

            <div className="mb-5 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/[0.08] text-base font-bold text-primary shadow-[0_8px_28px_hsl(var(--primary)/0.1)]">
                  {(user?.name || 'F').charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{user?.name || t('seller.title')}</p>
                  <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
                </div>
              </div>
            </div>

            <nav className="space-y-1.5" aria-label={t('seller.title')}>
              {sellerNavItems.map((item) => {
                const active = isActivePath(item.path);
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'group flex min-h-11 items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors',
                      active
                        ? 'bg-gradient-to-l from-primary/[0.16] to-primary/[0.035] text-primary shadow-[inset_-2px_0_hsl(var(--primary))]'
                        : 'text-muted-foreground hover:bg-white/[0.035] hover:text-foreground',
                    )}
                  >
                    <item.icon className="h-[18px] w-[18px] shrink-0" />
                    <span>{t(item.labelKey, { defaultValue: item.path === '/seller/compensation-bot' ? (isRTL ? 'بوت التعويضات' : 'Compensation bot') : item.labelKey })}</span>
                  </Link>
                );
              })}
            </nav>

            <div className="mt-auto rounded-2xl border border-white/[0.07] bg-white/[0.025] px-3.5 py-3 text-xs text-muted-foreground">
              <div className="flex items-center gap-2 text-foreground">
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_0_4px_rgba(52,211,153,0.09)]" />
                <span className="font-medium">{isRTL ? 'جميع الأنظمة تعمل' : 'All systems operational'}</span>
              </div>
              <p className="mt-1.5 ps-4 text-[11px]">{isRTL ? 'سلة · المزود · تيليجرام' : 'Salla · Provider · Telegram'}</p>
            </div>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <nav
            className="sticky top-16 z-30 border-b border-primary/10 bg-[#090c0c]/95 backdrop-blur-xl lg:hidden"
            aria-label={t('seller.title')}
          >
            <div className="scrollbar-hide flex gap-2 overflow-x-auto px-3 py-2.5 sm:px-5">
              {sellerNavItems.map((item) => {
                const active = isActivePath(item.path);
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex min-h-10 shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium transition-colors sm:text-sm',
                      active
                        ? 'border-primary/45 bg-primary text-primary-foreground shadow-[0_7px_24px_hsl(var(--primary)/0.13)]'
                        : 'border-white/[0.07] bg-card/75 text-muted-foreground hover:border-primary/30 hover:text-foreground',
                    )}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    <span>{t(item.labelKey, { defaultValue: item.path === '/seller/compensation-bot' ? (isRTL ? 'بوت التعويضات' : 'Compensation bot') : item.labelKey })}</span>
                  </Link>
                );
              })}
            </div>
          </nav>

          <main className="mx-auto w-full max-w-[1600px] px-3 py-4 sm:px-5 sm:py-6 lg:px-7 xl:px-9">
            {user?.role !== 'seller' ? (
              <div className="mx-auto max-w-xl rounded-2xl border bg-card p-6 text-center shadow-sm">
                <h1 className="text-xl font-semibold">{t('auth.unauthorized')}</h1>
                <p className="mt-2 text-sm text-muted-foreground">{t('seller.unauthorizedHint')}</p>
              </div>
            ) : (
              <Outlet />
            )}
          </main>
        </div>
      </div>
    </MainLayout>
  );
}
