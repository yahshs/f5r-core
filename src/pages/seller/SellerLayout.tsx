import { Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BarChart3, Bot, CreditCard, LayoutDashboard, Link2, Package, Server, ShoppingBag } from 'lucide-react';

import { WorkspaceShell, type WorkspaceNavItem } from '@/components/layout';

export default function SellerLayout() {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.dir() === 'rtl';

  const navItems: WorkspaceNavItem[] = [
    { path: '/seller/dashboard', icon: LayoutDashboard, label: t('seller.nav.dashboard') },
    { path: '/seller/analytics', icon: BarChart3, label: t('seller.nav.analytics') },
    { path: '/seller/orders', icon: Package, label: t('seller.nav.orders') },
    { path: '/seller/products', icon: ShoppingBag, label: t('seller.nav.products') },
    { path: '/seller/smm-providers', icon: Server, label: t('seller.nav.smmProviders') },
    { path: '/seller/salla', icon: Link2, label: t('seller.nav.salla') },
    {
      path: '/seller/compensation-bot',
      icon: Bot,
      label: t('seller.nav.compensationBot', { defaultValue: isRTL ? 'بوت التعويضات' : 'Compensation bot' }),
    },
    { path: '/seller/account', icon: CreditCard, label: t('seller.nav.account') },
  ];

  return (
    <WorkspaceShell
      navItems={navItems}
      workspaceLabel={t('seller.title')}
      workspaceHint={isRTL ? 'هذه نظرة مباشرة على تشغيل متجرك.' : 'A live view of your store operations.'}
    >
      <Outlet />
    </WorkspaceShell>
  );
}
