import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuthStore } from '@/store';

export default function AccountProfilePage() {
  const { t } = useTranslation();
  const { user } = useAuthStore();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('account.profile')}</h1>
        <p className="text-sm text-muted-foreground">{t('account.title')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('account.profile')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs text-muted-foreground">{t('auth.register.name')}</p>
            <p className="text-sm font-medium">{user?.name || '—'}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('auth.login.email')}</p>
            <p className="text-sm font-medium">{user?.email || '—'}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('common.status')}</p>
            <p className="text-sm font-medium">{user?.emailVerified ? t('seller.smmProviders.badges.testSuccess') : t('seller.smmProviders.badges.testFail')}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('common.role')}</p>
            <p className="text-sm font-medium">{user?.role || '—'}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

