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
  const { t } = useTranslation();
  const location = useLocation();
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
            <h2 className="mb-4 px-4 text-lg font-semibold">{t('admin.title')}</h2>
            <nav className="space-y-1">
              {adminNavItems.map((item) => {
                const isActive = location.pathname === item.path ||
                  (item.path !== '/admin' && location.pathname.startsWith(item.path));
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
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
          {/* Mobile admin nav */}
          <div className="mb-4 flex items-center justify-between lg:hidden">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="shrink-0"
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
