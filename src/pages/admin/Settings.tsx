import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { useAdminNotificationSummary, useAdminSettings, useUpdateAdminSetting } from '@/hooks/useApi';
import { Badge } from '@/components/ui/badge';

export default function AdminSettingsPage() {
  const { t } = useTranslation();
  const settingsQuery = useAdminSettings();
  const notificationSummaryQuery = useAdminNotificationSummary();
  const updateSetting = useUpdateAdminSetting();
  const [customKey, setCustomKey] = useState('');
  const [customValue, setCustomValue] = useState('');
  const [saveError, setSaveError] = useState('');

  const settings = settingsQuery.data?.data ?? [];
  const notificationSummary = notificationSummaryQuery.data?.data;
  const notificationStats = Array.isArray(notificationSummary?.stats)
    ? notificationSummary.stats
    : Object.entries(notificationSummary?.stats ?? {}).map(([status, count]) => ({
        channel: 'telegram',
        event_type: 'all',
        status,
        count: typeof count === 'number' ? count : 0,
      }));
  const failedNotificationJobs = Array.isArray(notificationSummary?.failed) ? notificationSummary.failed : [];
  const workersSetting = settings.find((s) => s.key === 'workers_enabled');
  const workersEnabled = workersSetting ? workersSetting.value !== '0' && workersSetting.value !== 'false' : true;
  const telegramBotToken = settings.find((s) => s.key === 'telegram_bot_token')?.value ?? '';
  const telegramBotUsername = settings.find((s) => s.key === 'telegram_bot_username')?.value ?? '';
  const telegramWebhookSecret = settings.find((s) => s.key === 'telegram_webhook_secret')?.value ?? '';
  const telegramReminderDays = settings.find((s) => s.key === 'telegram_subscription_reminder_days')?.value ?? '7,3,1';
  const telegramLowBalanceCooldown = settings.find((s) => s.key === 'telegram_low_balance_cooldown_minutes')?.value ?? '360';

  const [telegramTokenDraft, setTelegramTokenDraft] = useState('');
  const [telegramUsernameDraft, setTelegramUsernameDraft] = useState('');
  const [telegramSecretDraft, setTelegramSecretDraft] = useState('');
  const [telegramReminderDaysDraft, setTelegramReminderDaysDraft] = useState('');
  const [telegramLowBalanceCooldownDraft, setTelegramLowBalanceCooldownDraft] = useState('');

  const formatNotificationChannel = (channel: string) =>
    t(`admin.telegram.channels.${channel}`, { defaultValue: channel });
  const formatNotificationEventType = (eventType: string) =>
    t(`admin.telegram.eventTypes.${eventType}`, { defaultValue: eventType });
  const formatNotificationStatus = (status: string) =>
    t(`admin.telegram.statuses.${status}`, { defaultValue: status });

  const getDraftValue = (draft: string, saved: string) => (draft !== '' ? draft : saved);
  const upsertSetting = async (
    key: string,
    value: string,
    clearDraft?: () => void,
  ) => {
    setSaveError('');
    try {
      await updateSetting.mutateAsync({ key, value });
      clearDraft?.();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Failed to save setting');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('admin.settings')}</h1>
        <p className="text-sm text-muted-foreground">{t('admin.settingsSubtitle')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('admin.settingsWorkers')}</CardTitle>
          <CardDescription>{t('admin.settingsWorkersHint')}</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          {settingsQuery.isLoading ? (
            <Skeleton className="h-8 w-24" />
          ) : (
            <Switch
              checked={workersEnabled}
              onCheckedChange={(v) => updateSetting.mutate({ key: 'workers_enabled', value: v ? '1' : '0' })}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('admin.telegram.title')}</CardTitle>
          <CardDescription>{t('admin.telegram.hint')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {saveError ? <p className="text-sm text-red-400">{saveError}</p> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">{t('admin.telegram.botToken')}</p>
              <Input
                type="password"
                value={getDraftValue(telegramTokenDraft, telegramBotToken)}
                onChange={(e) => setTelegramTokenDraft(e.target.value)}
                placeholder="123456:ABC..."
              />
              <Button
                size="sm"
                disabled={updateSetting.isPending}
                onClick={() => upsertSetting('telegram_bot_token', getDraftValue(telegramTokenDraft, telegramBotToken), () => setTelegramTokenDraft(''))}
              >
                {t('common.save')}
              </Button>
            </div>
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">{t('admin.telegram.botUsername')}</p>
              <Input
                value={getDraftValue(telegramUsernameDraft, telegramBotUsername)}
                onChange={(e) => setTelegramUsernameDraft(e.target.value)}
                placeholder="f5r_bot"
              />
              <Button
                size="sm"
                disabled={updateSetting.isPending}
                onClick={() =>
                  upsertSetting('telegram_bot_username', getDraftValue(telegramUsernameDraft, telegramBotUsername), () =>
                    setTelegramUsernameDraft(''),
                  )
                }
              >
                {t('common.save')}
              </Button>
            </div>
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">{t('admin.telegram.webhookSecret')}</p>
              <Input
                value={getDraftValue(telegramSecretDraft, telegramWebhookSecret)}
                onChange={(e) => setTelegramSecretDraft(e.target.value)}
                placeholder="secret"
              />
              <Button
                size="sm"
                disabled={updateSetting.isPending}
                onClick={() =>
                  upsertSetting('telegram_webhook_secret', getDraftValue(telegramSecretDraft, telegramWebhookSecret), () =>
                    setTelegramSecretDraft(''),
                  )
                }
              >
                {t('common.save')}
              </Button>
            </div>
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">{t('admin.telegram.reminderDays')}</p>
              <Input
                value={getDraftValue(telegramReminderDaysDraft, telegramReminderDays)}
                onChange={(e) => setTelegramReminderDaysDraft(e.target.value)}
                placeholder="7,3,1"
              />
              <Button
                size="sm"
                disabled={updateSetting.isPending}
                onClick={() =>
                  upsertSetting(
                    'telegram_subscription_reminder_days',
                    getDraftValue(telegramReminderDaysDraft, telegramReminderDays),
                    () => setTelegramReminderDaysDraft(''),
                  )
                }
              >
                {t('common.save')}
              </Button>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <p className="text-xs text-muted-foreground">{t('admin.telegram.lowBalanceCooldown')}</p>
              <Input
                value={getDraftValue(telegramLowBalanceCooldownDraft, telegramLowBalanceCooldown)}
                onChange={(e) => setTelegramLowBalanceCooldownDraft(e.target.value)}
                placeholder="360"
              />
              <Button
                size="sm"
                disabled={updateSetting.isPending}
                onClick={() =>
                  upsertSetting(
                    'telegram_low_balance_cooldown_minutes',
                    getDraftValue(telegramLowBalanceCooldownDraft, telegramLowBalanceCooldown),
                    () => setTelegramLowBalanceCooldownDraft(''),
                  )
                }
              >
                {t('common.save')}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('admin.telegram.summary')}</CardTitle>
          <CardDescription>{t('admin.telegram.summaryHint')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {notificationSummaryQuery.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {notificationStats.map((row) => (
                  <div key={`${row.channel}-${row.event_type}-${row.status}`} className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">{formatNotificationChannel(row.channel)}</p>
                    <p className="font-medium">{formatNotificationEventType(row.event_type)}</p>
                    <div className="mt-2 flex items-center justify-between">
                      <Badge variant="outline">{formatNotificationStatus(row.status)}</Badge>
                      <span className="text-sm font-semibold">{row.count}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium">{t('admin.telegram.failedJobs')}</p>
                {failedNotificationJobs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('common.empty')}</p>
                ) : (
                  failedNotificationJobs.map((row) => (
                    <div key={row.id} className="rounded-lg border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">{formatNotificationEventType(row.event_type)}</span>
                        <span className="text-xs text-muted-foreground">{row.updated_at}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">{row.seller_id}</p>
                      <p className="mt-1 text-sm">{row.last_error || t('admin.telegram.unknownError')}</p>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('admin.settingsCustom')}</CardTitle>
          <CardDescription>{t('admin.settingsCustomHint')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <Input placeholder={t('admin.settingsKey')} value={customKey} onChange={(e) => setCustomKey(e.target.value)} />
            <Input placeholder={t('admin.settingsValue')} value={customValue} onChange={(e) => setCustomValue(e.target.value)} />
            <Button
              onClick={() => {
                if (!customKey.trim()) return;
                updateSetting.mutate({ key: customKey.trim(), value: customValue });
                setCustomKey('');
                setCustomValue('');
              }}
            >
              {t('common.save')}
            </Button>
          </div>
          {settingsQuery.isLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : settings.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('common.empty')}</p>
          ) : (
            <div className="space-y-2">
              {settings.map((s) => (
                <div key={s.key} className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <p className="text-sm font-medium">{s.key}</p>
                    <p className="text-xs text-muted-foreground">{s.value}</p>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => updateSetting.mutate({ key: s.key, value: s.value })}>
                    {t('common.refresh')}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
