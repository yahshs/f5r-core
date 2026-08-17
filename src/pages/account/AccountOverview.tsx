import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Package, ShoppingBag, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuthStore } from '@/store';
import { useUserOrders } from '@/hooks/useApi';

export default function AccountOverview() {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const { data: ordersData } = useUserOrders();
  const orderList = ordersData?.data ?? [];

  const stats = [
    {
      icon: ShoppingBag,
      label: t('account.stats.totalOrders'),
      value: ordersData?.total || orderList.length || 0,
      color: 'text-primary',
      bg: 'bg-primary/10',
    },
    {
      icon: Package,
      label: t('account.stats.activeOrders'),
      value: orderList.filter(o => ['pending', 'approved', 'in_progress'].includes(o.status)).length || 0,
      color: 'text-warning',
      bg: 'bg-warning/10',
    },
    {
      icon: TrendingUp,
      label: t('account.stats.totalSpent'),
      value: `${orderList.reduce((acc, o) => acc + (o.totalPrice || 0), 0).toFixed(2)} ${t('common.currency')}`,
      color: 'text-success',
      bg: 'bg-success/10',
    },
  ];

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.1 } },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0 },
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('account.title')}</h1>
        <p className="text-muted-foreground">Welcome back, {user?.name}!</p>
      </div>

      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="grid gap-4 sm:grid-cols-2"
      >
        {stats.map((stat) => (
          <motion.div key={stat.label} variants={itemVariants}>
            <Card className="overflow-hidden">
              <CardContent className="flex items-center gap-4 p-6">
                <div className={`flex h-14 w-14 items-center justify-center rounded-xl ${stat.bg}`}>
                  <stat.icon className={`h-7 w-7 ${stat.color}`} />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{stat.label}</p>
                  <p className="text-2xl font-bold">{stat.value}</p>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </motion.div>

      {/* Recent Orders */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Orders</CardTitle>
        </CardHeader>
        <CardContent>
          {orderList.slice(0, 5).map((order) => (
            <div key={order.internal_id ?? order.id} className="flex items-center justify-between border-b py-3 last:border-0">
              <div>
                <p className="font-medium">{order.salla_order_id ?? order.id}</p>
                <p className="text-sm text-muted-foreground">{order.service_name ?? '-'}</p>
              </div>
              <div className="text-right">
                <p className="font-medium">{Number(order.totalPrice ?? 0).toFixed(2)} {t('common.currency')}</p>
                <p className="text-sm text-muted-foreground">{order.status}</p>
              </div>
            </div>
          )) || <p className="text-muted-foreground">{t('orders.empty')}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
