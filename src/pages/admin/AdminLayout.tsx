import { Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BarChart3, CreditCard, LayoutDashboard, Link2, Package, Server, Settings, Users } from 'lucide-react';

import { WorkspaceShell, type WorkspaceNavItem } from '@/components/layout';

export default function AdminLayout() {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.dir() === 'rtl';

  const navItems: WorkspaceNavItem[] = [
    { path: '/admin', icon: LayoutDashboard, label: t('admin.nav.dashboard'), exact: true },
    { path: '/admin/analytics', icon: BarChart3, label: t('admin.nav.analytics') },
    { path: '/admin/orders', icon: Package, label: t('admin.nav.orders') },
    { path: '/admin/users', icon: Users, label: t('admin.nav.users') },
    { path: '/admin/providers', icon: Server, label: t('admin.nav.providers') },
    { path: '/admin/salla-connections', icon: Link2, label: t('admin.nav.salla') },
    { path: '/admin/subscription-requests', icon: CreditCard, label: t('admin.nav.subscriptionRequests') },
    { path: '/admin/settings', icon: Settings, label: t('admin.nav.settings') },
  ];

  return (
    <WorkspaceShell
      navItems={navItems}
      workspaceLabel={t('admin.title')}
      workspaceHint={isRTL ? 'إدارة المنصة ومراقبة التشغيل من مكان واحد.' : 'Manage and monitor the platform from one place.'}
    >
      <Outlet />
    </WorkspaceShell>
  );
}
