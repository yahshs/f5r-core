import { Link, Outlet, useLocation } from 'react-router-dom';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import {
  LayoutDashboard,
  Package,
  Users,
  Settings,
  Server,
  Link2,
  CreditCard,
  Menu,
  BarChart3,
} from 'lucide-react';
import { MainLayout } from '@/components/layout';
import { cn } from '@/lib/utils';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';

const adminNavItems = [
  { path: '/admin', icon: LayoutDashboard, labelKey: 'admin.nav.dashboard' },
  { path: '/admin/analytics', icon: BarChart3, labelKey: 'admin.nav.analytics' },
  { path: '/admin/orders', icon: Package, labelKey: 'admin.nav.orders' },
  { path: '/admin/users', icon: Users, labelKey: 'admin.nav.users' },
  { path: '/admin/providers', icon: Server, labelKey: 'admin.nav.providers' },
  { path: '/admin/salla-connections', icon: Link2, labelKey: 'admin.nav.salla' },
  { path: '/admin/subscription-requests', icon: CreditCard, labelKey: 'admin.nav.subscriptionRequests' },
  { path: '/admin/settings', icon: Settings, labelKey: 'admin.nav.settings' },
];

export default function AdminLayout() {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const isRTL = i18n.dir() === 'rtl';

  return (
    <MainLayout showFooter={false} className="dark bg-background text-foreground">
      <div className="f5r-workspace-bg flex min-h-[calc(100vh-4rem)]">
        {/* Sidebar */}
        <motion.aside
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className={cn(
            'hidden w-64 bg-[#0b0e0f]/90 backdrop-blur-2xl lg:sticky lg:top-16 lg:block lg:h-[calc(100vh-4rem)] lg:overflow-y-auto',
            isRTL ? 'border-l border-primary/10' : 'border-r border-primary/10',
          )}
        >
          <div className="p-4 pb-8">
            <div className="mb-6 px-2 pt-1">
              <p className="text-sm font-semibold tracking-wide">F5R CORE</p>
              <p className="mt-1 text-xs text-muted-foreground">{t('admin.title')}</p>
            </div>
            <nav className="space-y-1.5">
              {adminNavItems.map((item) => {
                const isActive = location.pathname === item.path ||
                  (item.path !== '/admin' && location.pathname.startsWith(item.path));
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={cn(
                      "flex min-h-11 items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-gradient-to-l from-primary/[0.16] to-primary/[0.035] text-primary shadow-[inset_-2px_0_hsl(var(--primary))]"
                        : "text-muted-foreground hover:bg-white/[0.035] hover:text-foreground"
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
        <main className="min-w-0 flex-1 overflow-auto px-4 pb-6 pt-4 sm:px-6 lg:p-7 xl:p-9">
          {/* Mobile admin nav */}
          <div className="mb-4 flex items-center justify-between rounded-2xl border border-white/[0.07] bg-card/75 p-2.5 backdrop-blur-xl lg:hidden">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="shrink-0 rounded-xl border-primary/20 bg-primary/[0.06]"
              onClick={() => setMobileNavOpen(true)}
              aria-label={t('admin.title')}
            >
              <Menu className="h-5 w-5" />
            </Button>
            <h2 className="text-base font-semibold">{t('admin.title')}</h2>
            <div className="w-10" />
          </div>
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetContent side="right" className="w-72 p-0">
              <SheetHeader className="border-b p-4">
                <SheetTitle>{t('admin.title')}</SheetTitle>
              </SheetHeader>
              <div className="max-h-[calc(100vh-5rem)] overflow-y-auto p-4 pb-8">
                <nav className="space-y-1">
                  {adminNavItems.map((item) => {
                    const isActive =
                      location.pathname === item.path || (item.path !== '/admin' && location.pathname.startsWith(item.path));
                    return (
                      <Link
                        key={item.path}
                        to={item.path}
                        onClick={() => setMobileNavOpen(false)}
                        className={cn(
                          'flex items-center gap-3 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors',
                          isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
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

          <Outlet />
        </main>
      </div>
    </MainLayout>
  );
}
