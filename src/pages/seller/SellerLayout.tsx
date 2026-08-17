import { Link, Outlet, useLocation } from 'react-router-dom';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { BarChart3, CreditCard, LayoutDashboard, Link2, Menu, Package, Server, ShoppingBag } from 'lucide-react';
import { MainLayout } from '@/components/layout';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';

const sellerNavItems = [
  { path: '/seller/dashboard', icon: LayoutDashboard, labelKey: 'seller.nav.dashboard' },
  { path: '/seller/analytics', icon: BarChart3, labelKey: 'seller.nav.analytics' },
  { path: '/seller/orders', icon: Package, labelKey: 'seller.nav.orders' },
  { path: '/seller/products', icon: ShoppingBag, labelKey: 'seller.nav.products' },
  { path: '/seller/smm-providers', icon: Server, labelKey: 'seller.nav.smmProviders' },
  { path: '/seller/salla', icon: Link2, labelKey: 'seller.nav.salla' },
  { path: '/seller/account', icon: CreditCard, labelKey: 'seller.nav.account' },
];

export default function SellerLayout() {
  const { t } = useTranslation();
  const location = useLocation();
  const { user } = useAuthStore();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <MainLayout showFooter={false}>
      <div className="flex min-h-[calc(100vh-4rem)]">
        {/* Sidebar */}
        <motion.aside
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="hidden w-64 border-r bg-card lg:block lg:sticky lg:top-16 lg:h-[calc(100vh-4rem)] lg:overflow-y-auto"
        >
          <div className="p-4 pb-8">
            <h2 className="mb-4 px-4 text-lg font-semibold">{t('seller.title')}</h2>
            <nav className="space-y-1">
              {sellerNavItems.map((item) => {
                const isActive = location.pathname === item.path || location.pathname.startsWith(item.path);
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <item.icon className="h-5 w-5" />
                    {t(item.labelKey)}
                  </Link>
                );
              })}
            </nav>
          </div>
        </motion.aside>

        {/* Main Content */}
        <main className="flex-1 overflow-auto px-4 pb-6 pt-4 sm:px-6 lg:p-8">
          {/* Mobile seller nav */}
          <div className="mb-4 flex items-center justify-between lg:hidden">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="shrink-0"
              onClick={() => setMobileNavOpen(true)}
              aria-label={t('seller.title')}
            >
              <Menu className="h-5 w-5" />
            </Button>
            <h2 className="text-base font-semibold">{t('seller.title')}</h2>
            <div className="w-10" />
          </div>
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetContent side="right" className="w-72 p-0">
              <SheetHeader className="border-b p-4">
                <SheetTitle>{t('seller.title')}</SheetTitle>
              </SheetHeader>
              <div className="max-h-[calc(100vh-5rem)] overflow-y-auto p-4 pb-8">
                <nav className="space-y-1">
                  {sellerNavItems.map((item) => {
                    const isActive = location.pathname === item.path || location.pathname.startsWith(item.path);
                    return (
                      <Link
                        key={item.path}
                        to={item.path}
                        onClick={() => setMobileNavOpen(false)}
                        className={cn(
                          "flex items-center gap-3 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors",
                          isActive
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground",
                        )}
                      >
                        <item.icon className="h-5 w-5" />
                        {t(item.labelKey)}
                      </Link>
                    );
                  })}
                </nav>
              </div>
            </SheetContent>
          </Sheet>

          {user?.role !== 'seller' ? (
            <div className="mx-auto max-w-xl rounded-lg border bg-card p-6 text-center">
              <h1 className="text-xl font-semibold">{t('auth.unauthorized')}</h1>
              <p className="mt-2 text-sm text-muted-foreground">{t('seller.unauthorizedHint')}</p>
            </div>
          ) : (
            <Outlet />
          )}
        </main>
      </div>
    </MainLayout>
  );
}
