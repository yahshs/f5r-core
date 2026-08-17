import { Link, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { User, CreditCard, Package, MessageSquare, Settings, LayoutDashboard } from 'lucide-react';
import { MainLayout } from '@/components/layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuthStore } from '@/store';
import { cn } from '@/lib/utils';

const accountNavItems = [
  { path: '/account', icon: LayoutDashboard, labelKey: 'account.overview' },
  { path: '/account/profile', icon: User, labelKey: 'account.profile' },
  { path: '/account/orders', icon: Package, labelKey: 'account.orders' },
  { path: '/account/billing', icon: CreditCard, labelKey: 'account.billing' },
  { path: '/account/tickets', icon: MessageSquare, labelKey: 'account.tickets' },
];

export default function AccountLayout() {
  const { t } = useTranslation();
  const location = useLocation();
  const { user } = useAuthStore();

  return (
    <MainLayout>
      <section className="py-8 lg:py-12">
        <div className="section-container">
          {!user ? (
            <Card className="mx-auto max-w-xl">
              <CardHeader>
                <CardTitle>{t('auth.unauthorized')}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{t('auth.unauthorized')}</p>
                <Link to="/auth/login" className="mt-4 inline-flex text-sm font-medium text-primary hover:underline">
                  {t('nav.login')}
                </Link>
              </CardContent>
            </Card>
          ) : (
          <div className="grid gap-8 lg:grid-cols-4">
            {/* Sidebar */}
            <motion.aside
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="lg:col-span-1"
            >
              <Card>
                <CardHeader className="text-center pb-4">
                  <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-primary text-2xl font-bold text-primary-foreground">
                    {(user?.name?.charAt(0) || '?').toUpperCase()}
                  </div>
                  <CardTitle className="text-lg">{user?.name}</CardTitle>
                  <p className="text-sm text-muted-foreground">{user?.email}</p>
                </CardHeader>
                <CardContent className="p-2">
                  <nav className="space-y-1">
                    {accountNavItems.map((item) => {
                      const isActive = location.pathname === item.path || 
                        (item.path !== '/account' && location.pathname.startsWith(item.path));
                      return (
                        <Link
                          key={item.path}
                          to={item.path}
                          className={cn(
                            "flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium transition-colors",
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
                </CardContent>
              </Card>
            </motion.aside>

            {/* Main Content */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="lg:col-span-3"
            >
              <Outlet />
            </motion.div>
          </div>
          )}
        </div>
      </section>
    </MainLayout>
  );
}
