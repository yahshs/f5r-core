import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { useAuthStore } from "@/store";
import {
  useRegenerateSellerNotificationLink,
  useRequestSubscriptionUpgrade,
  useSellerNotifications,
  useSellerSubscription,
  useUnlinkSellerTelegram,
  useUpdateSellerNotifications,
} from "@/hooks/useApi";

type SellerPlan = "basic" | "plus" | "pro" | "special";
const COMMON_TIMEZONES = ["Asia/Riyadh", "Africa/Lagos", "UTC", "Europe/Istanbul", "Europe/London"];

export default function SellerAccountPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuthStore();
  const subscriptionQuery = useSellerSubscription();
  const notificationsQuery = useSellerNotifications();
  const requestUpgrade = useRequestSubscriptionUpgrade();
  const updateNotifications = useUpdateSellerNotifications();
  const regenerateLink = useRegenerateSellerNotificationLink();
  const unlinkTelegram = useUnlinkSellerTelegram();

  const subscription = subscriptionQuery.data?.subscription;
  const pending = subscriptionQuery.data?.pendingRequest;
  const notificationSettings = notificationsQuery.data;

  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [requestedPlan, setRequestedPlan] = useState<SellerPlan>("plus");
  const [timeZone, setTimeZone] = useState("Asia/Riyadh");
  const [notificationMode, setNotificationMode] = useState<"all" | "failed_only">("all");
  const [notifyExecutionFailed, setNotifyExecutionFailed] = useState(true);
  const [notifySubscriptionEnding, setNotifySubscriptionEnding] = useState(true);
  const [notifyLowBalance, setNotifyLowBalance] = useState(true);
  const [lowBalanceThreshold, setLowBalanceThreshold] = useState("");
  const [subscriptionReminderCount, setSubscriptionReminderCount] = useState<"1" | "2" | "3">("3");
  const [monthlyReportEnabled, setMonthlyReportEnabled] = useState(false);
  const [monthlyReportTimeLocal, setMonthlyReportTimeLocal] = useState("18:00");

  const renewAtLabel = useMemo(() => {
    if (!subscription?.renewAt) return "-";
    try {
      return new Date(subscription.renewAt).toLocaleString();
    } catch {
      return subscription.renewAt;
    }
  }, [subscription?.renewAt]);

  const currentPlan = (subscription?.plan as SellerPlan | undefined) ?? "basic";

  useEffect(() => {
    if (!notificationSettings) return;
    setTimeZone(notificationSettings.settings.timezone);
    setNotificationMode(notificationSettings.settings.notificationMode);
    setNotifyExecutionFailed(notificationSettings.settings.notifyExecutionFailed);
    setNotifySubscriptionEnding(notificationSettings.settings.notifySubscriptionEnding);
    setNotifyLowBalance(notificationSettings.settings.notifyLowBalance);
    setLowBalanceThreshold(notificationSettings.settings.lowBalanceThreshold === null ? "" : String(notificationSettings.settings.lowBalanceThreshold));
    setSubscriptionReminderCount(String(notificationSettings.settings.subscriptionReminderCount) as "1" | "2" | "3");
    setMonthlyReportEnabled(notificationSettings.settings.monthlyReportEnabled);
    setMonthlyReportTimeLocal(notificationSettings.settings.monthlyReportTimeLocal);
  }, [notificationSettings]);

  const submitUpgradeRequest = async () => {
    try {
      await requestUpgrade.mutateAsync(requestedPlan);
      toast({
        title: t("common.success"),
        description: t("seller.account.toasts.upgradeRequested"),
      });
      setUpgradeOpen(false);
    } catch (e: any) {
      toast({ title: t("common.error"), description: e.message, variant: "destructive" });
    }
  };

  const saveNotifications = async () => {
    try {
      await updateNotifications.mutateAsync({
        locale: i18n.language === "en" ? "en" : "ar",
        timezone: timeZone,
        notify_execution_failed: notifyExecutionFailed,
        notify_subscription_ending: notifySubscriptionEnding,
        notify_low_balance: notifyLowBalance,
        notification_mode: notificationMode,
        low_balance_threshold: lowBalanceThreshold.trim().length ? Number(lowBalanceThreshold) : null,
        subscription_reminder_count: Number(subscriptionReminderCount),
        monthly_report_enabled: monthlyReportEnabled,
        monthly_report_time_local: monthlyReportTimeLocal,
      });
      toast({
        title: t("common.success"),
        description: t("seller.account.notifications.saved"),
      });
    } catch (e: any) {
      toast({ title: t("common.error"), description: e.message, variant: "destructive" });
    }
  };

  const refreshTelegramLink = async () => {
    try {
      await regenerateLink.mutateAsync();
      toast({
        title: t("common.success"),
        description: t("seller.account.notifications.linkRefreshed"),
      });
    } catch (e: any) {
      toast({ title: t("common.error"), description: e.message, variant: "destructive" });
    }
  };

  const disconnectTelegram = async () => {
    try {
      await unlinkTelegram.mutateAsync();
      toast({
        title: t("common.success"),
        description: t("seller.account.notifications.unlinked"),
      });
    } catch (e: any) {
      toast({ title: t("common.error"), description: e.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("seller.nav.account")}</h1>
        <p className="text-sm text-muted-foreground">{t("seller.account.subtitle")}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>{t("seller.account.infoTitle")}</CardTitle>
            <CardDescription>{t("seller.account.infoHint")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="text-xs text-muted-foreground">{t("seller.account.fields.name")}</p>
              <p className="text-sm font-medium">{user?.name || "-"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t("seller.account.fields.email")}</p>
              <p className="text-sm font-medium">{user?.email || "-"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t("seller.account.fields.phone")}</p>
              <p className="text-sm font-medium">{user?.phone || "-"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t("seller.account.fields.role")}</p>
              <p className="text-sm font-medium">{user?.role || "-"}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t("seller.account.subscriptionTitle")}</CardTitle>
            <CardDescription>{t("seller.account.subscriptionHint")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">{t("seller.account.fields.status")}</p>
                <Badge
                  variant="secondary"
                  className={
                    subscription?.status === "active"
                      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                      : "bg-rose-500/10 text-rose-700 dark:text-rose-400"
                  }
                >
                  {subscription?.status === "active" ? t("seller.account.status.active") : t("seller.account.status.inactive")}
                </Badge>
              </div>
              <div className="text-sm text-muted-foreground">
                {t("seller.account.fields.renewAt")}: {renewAtLabel}
              </div>
            </div>

            <div className="space-y-2">
              <Label>{t("seller.account.fields.plan")}</Label>
              <Select value={currentPlan} disabled>
                <SelectTrigger className="w-full sm:w-72">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="basic">{t("seller.account.plans.basic")}</SelectItem>
                  <SelectItem value="plus">{t("seller.account.plans.plus")}</SelectItem>
                  <SelectItem value="pro">{t("seller.account.plans.pro")}</SelectItem>
                  <SelectItem value="special">{t("seller.account.plans.special")}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{t("seller.account.planReadOnlyHint")}</p>
            </div>

            {pending ? (
              <div className="rounded-lg border p-3">
                <p className="text-sm font-medium">{t("seller.account.pendingTitle")}</p>
                <p className="text-xs text-muted-foreground">
                  {t("seller.account.pendingHint")} {t(`seller.account.plans.${pending.requestedPlan}`)}
                </p>
              </div>
            ) : null}

            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Dialog open={upgradeOpen} onOpenChange={setUpgradeOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" disabled={!subscription || !!pending}>
                    {t("seller.account.upgradeRequest")}
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-h-[85vh] w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-lg">
                  <DialogHeader>
                    <DialogTitle>{t("seller.account.upgradeDialog.title")}</DialogTitle>
                    <DialogDescription>{t("seller.account.upgradeDialog.hint")}</DialogDescription>
                  </DialogHeader>

                  <div className="space-y-2">
                    <Label>{t("seller.account.upgradeDialog.requestedPlan")}</Label>
                    <Select value={requestedPlan} onValueChange={(v) => setRequestedPlan(v as SellerPlan)}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="basic">{t("seller.account.plans.basic")}</SelectItem>
                        <SelectItem value="plus">{t("seller.account.plans.plus")}</SelectItem>
                        <SelectItem value="pro">{t("seller.account.plans.pro")}</SelectItem>
                        <SelectItem value="special">{t("seller.account.plans.special")}</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">{t("seller.account.upgradeDialog.reviewNote")}</p>
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                    <Button variant="outline" onClick={() => setUpgradeOpen(false)}>
                      {t("common.cancel")}
                    </Button>
                    <Button onClick={submitUpgradeRequest} disabled={requestUpgrade.isPending}>
                      {requestUpgrade.isPending ? t("common.loading") : t("seller.account.upgradeDialog.submit")}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("seller.account.notifications.title")}</CardTitle>
          <CardDescription>{t("seller.account.notifications.hint")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-lg border p-4">
              <p className="text-xs text-muted-foreground">{t("seller.account.notifications.telegramStatus")}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge
                  variant="secondary"
                  className={
                    notificationSettings?.telegram.linked
                      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                      : "bg-muted text-muted-foreground"
                  }
                >
                  {notificationSettings?.telegram.linked
                    ? t("seller.account.notifications.linked")
                    : t("seller.account.notifications.notLinked")}
                </Badge>
                {notificationSettings?.telegram.username ? (
                  <span className="text-sm text-muted-foreground">@{notificationSettings.telegram.username}</span>
                ) : null}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                {notificationSettings?.telegram.botUsername
                  ? `@${notificationSettings.telegram.botUsername}`
                  : t("seller.account.notifications.botMissing")}
              </p>
            </div>

            <div className="rounded-lg border p-4 lg:col-span-2">
              <p className="text-xs text-muted-foreground">{t("seller.account.notifications.linkHint")}</p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <Button asChild disabled={!notificationSettings?.telegram.deepLink}>
                  <a
                    href={notificationSettings?.telegram.deepLink || "#"}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("seller.account.notifications.openBot")}
                  </a>
                </Button>
                <Button
                  variant="outline"
                  onClick={refreshTelegramLink}
                  disabled={regenerateLink.isPending}
                >
                  {t("seller.account.notifications.refreshLink")}
                </Button>
                <Button
                  variant="outline"
                  onClick={disconnectTelegram}
                  disabled={!notificationSettings?.telegram.linked || unlinkTelegram.isPending}
                >
                  {t("seller.account.notifications.unlinkButton")}
                </Button>
              </div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <Label>{t("seller.account.notifications.notificationMode")}</Label>
              <Select value={notificationMode} onValueChange={(value) => setNotificationMode(value as "all" | "failed_only")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("seller.account.notifications.modes.all")}</SelectItem>
                  <SelectItem value="failed_only">{t("seller.account.notifications.modes.failedOnly")}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{t("seller.account.notifications.notificationModeHint")}</p>
            </div>

            <div className="space-y-2">
              <Label>{t("seller.account.notifications.timezone")}</Label>
              <Select value={timeZone} onValueChange={setTimeZone}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMMON_TIMEZONES.map((zone) => (
                    <SelectItem key={zone} value={zone}>
                      {zone}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{t("seller.account.notifications.monthlyReportTime")}</Label>
              <Input
                type="time"
                value={monthlyReportTimeLocal}
                onChange={(e) => setMonthlyReportTimeLocal(e.target.value)}
                disabled={!monthlyReportEnabled || notificationMode !== "all"}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("seller.account.notifications.subscriptionReminderCount")}</Label>
              <Select value={subscriptionReminderCount} onValueChange={(value) => setSubscriptionReminderCount(value as "1" | "2" | "3")}>
                <SelectTrigger disabled={!notifySubscriptionEnding || notificationMode !== "all"}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">{t("seller.account.notifications.reminderCounts.one")}</SelectItem>
                  <SelectItem value="2">{t("seller.account.notifications.reminderCounts.two")}</SelectItem>
                  <SelectItem value="3">{t("seller.account.notifications.reminderCounts.three")}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{t("seller.account.notifications.subscriptionReminderCountHint")}</p>
            </div>
            <div className="space-y-2">
              <Label>{t("seller.account.notifications.lowBalanceThresholdLabel")}</Label>
              <Input
                type="number"
                step="0.01"
                inputMode="decimal"
                dir="ltr"
                value={lowBalanceThreshold}
                onChange={(e) => setLowBalanceThreshold(e.target.value)}
                disabled={!notifyLowBalance || notificationMode !== "all"}
                placeholder="0"
              />
              <p className="text-xs text-muted-foreground">{t("seller.account.notifications.lowBalanceThresholdHint")}</p>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border p-4">
            <div>
              <p className="text-sm font-medium">{t("seller.account.notifications.monthlyReport")}</p>
              <p className="text-xs text-muted-foreground">{t("seller.account.notifications.monthlyReportHint")}</p>
            </div>
            <Switch checked={monthlyReportEnabled} onCheckedChange={setMonthlyReportEnabled} disabled={notificationMode !== "all"} />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-lg border p-4">
              <p className="text-sm font-medium">{t("seller.account.notifications.executionFailed")}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t("seller.account.notifications.executionFailedHint")}</p>
              <Switch checked={notifyExecutionFailed} onCheckedChange={setNotifyExecutionFailed} className="mt-3" />
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-sm font-medium">{t("seller.account.notifications.subscriptionEnding")}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t("seller.account.notifications.subscriptionEndingHint")}</p>
              <Switch checked={notifySubscriptionEnding} onCheckedChange={setNotifySubscriptionEnding} className="mt-3" />
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-sm font-medium">{t("seller.account.notifications.lowBalance")}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t("seller.account.notifications.lowBalanceHint")}</p>
              <Switch checked={notifyLowBalance} onCheckedChange={setNotifyLowBalance} className="mt-3" />
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={saveNotifications} disabled={updateNotifications.isPending || notificationsQuery.isLoading}>
              {updateNotifications.isPending ? t("common.loading") : t("common.save")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
