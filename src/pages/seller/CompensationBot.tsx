import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Bot, CheckCircle2, Clock3, Copy, ExternalLink, History, ShieldCheck, XCircle } from "lucide-react";

import { compensationBotApi, type CompensationBotData } from "@/api/compensationBot";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/use-toast";

function statusStyle(status: CompensationBotData["recentRequests"][number]["status"]) {
  if (status === "SUCCESS") return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
  if (status === "PARTIAL") return "bg-amber-500/10 text-amber-700 dark:text-amber-400";
  if (status === "FAILED") return "bg-rose-500/10 text-rose-700 dark:text-rose-400";
  return "bg-sky-500/10 text-sky-700 dark:text-sky-400";
}

export default function CompensationBotPage() {
  const { i18n } = useTranslation();
  const isArabic = i18n.language.startsWith("ar");
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(false);
  const [maxCompensations, setMaxCompensations] = useState("2");
  const [cooldownHours, setCooldownHours] = useState("24");
  const [windowDays, setWindowDays] = useState("30");

  const copy = useMemo(() => isArabic ? {
    title: "بوت التعويضات",
    subtitle: "خدمة ذاتية لمتابعة الطلبات وطلب التعويض من مزود الخدمة.",
    active: "البوت مفعل",
    inactive: "البوت متوقف",
    activeHint: "عند التفعيل يستطيع العميل متابعة طلبه وطلب التعويض ضمن الحدود المحددة.",
    botLink: "رابط البوت للعملاء",
    botLinkHint: "هذا الرابط ثابت. ضعه في متجرك أو أرسله للعملاء ولن يتغير مع كل دخول.",
    copyLink: "نسخ الرابط",
    openBot: "فتح البوت",
    missingBot: "اسم بوت تيليجرام غير مضبوط من إعدادات الإدارة.",
    rules: "قواعد التعويض",
    rulesHint: "تطبق على كل طلب بشكل مستقل وتمنع التكرار والاستغلال.",
    max: "أقصى عدد تعويضات لكل طلب",
    cooldown: "المدة بين كل تعويض",
    cooldownUnit: "ساعة",
    window: "صلاحية التعويض من تاريخ الطلب",
    windowUnit: "يوم",
    save: "حفظ الإعدادات",
    saving: "جاري الحفظ...",
    saved: "تم حفظ إعدادات البوت.",
    statsTotal: "إجمالي الطلبات",
    statsSuccess: "تعويض ناجح",
    statsPending: "قيد المعالجة",
    statsFailed: "فشل",
    recent: "آخر طلبات التعويض",
    recentHint: "سجل واضح لكل طلب تعويض أرسله العملاء.",
    empty: "لا توجد طلبات تعويض حتى الآن.",
    order: "الطلب",
    attempt: "التعويض",
    securityTitle: "التعويض آمن على الطلب الأصلي",
    securityHint: "العميل لا يستطيع تغيير الرابط أو الكمية أو المزود. البوت يرسل طلب Refill للطلب الأصلي فقط.",
    invalid: "تأكد أن جميع القيم صحيحة.",
  } : {
    title: "Compensation bot",
    subtitle: "Self-service order tracking and provider refill requests.",
    active: "Bot enabled",
    inactive: "Bot disabled",
    activeHint: "Customers can track orders and request refills within the limits below.",
    botLink: "Customer bot link",
    botLinkHint: "This link is stable. Add it to your store or send it to customers.",
    copyLink: "Copy link",
    openBot: "Open bot",
    missingBot: "Telegram bot username is not configured by the administrator.",
    rules: "Compensation rules",
    rulesHint: "Applied per order to prevent repeated or abusive requests.",
    max: "Maximum refills per order",
    cooldown: "Time between refills",
    cooldownUnit: "hours",
    window: "Refill window from order date",
    windowUnit: "days",
    save: "Save settings",
    saving: "Saving...",
    saved: "Bot settings saved.",
    statsTotal: "Total requests",
    statsSuccess: "Successful",
    statsPending: "Pending",
    statsFailed: "Failed",
    recent: "Recent compensation requests",
    recentHint: "A clear record of every customer refill request.",
    empty: "No compensation requests yet.",
    order: "Order",
    attempt: "Request",
    securityTitle: "Refills stay tied to the original order",
    securityHint: "Customers cannot change the target, quantity, or provider. The bot only refills the original provider order.",
    invalid: "Check that all values are valid.",
  }, [isArabic]);

  const query = useQuery({
    queryKey: ["seller", "compensation-bot"],
    queryFn: compensationBotApi.get,
    refetchInterval: 20_000,
  });

  useEffect(() => {
    if (!query.data) return;
    setEnabled(query.data.settings.isEnabled);
    setMaxCompensations(String(query.data.settings.maxCompensationsPerOrder));
    setCooldownHours(String(query.data.settings.compensationCooldownHours));
    setWindowDays(String(query.data.settings.compensationWindowDays));
  }, [query.data]);

  const update = useMutation({
    mutationFn: compensationBotApi.update,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["seller", "compensation-bot"] });
      toast({ title: copy.saved });
    },
    onError: (error: Error) => toast({ title: error.message, variant: "destructive" }),
  });

  const save = () => {
    const max = Number(maxCompensations);
    const cooldown = Number(cooldownHours);
    const window = Number(windowDays);
    if (!Number.isInteger(max) || max < 0 || max > 10 || !Number.isInteger(cooldown) || cooldown < 1 || cooldown > 720 || !Number.isInteger(window) || window < 1 || window > 365) {
      toast({ title: copy.invalid, variant: "destructive" });
      return;
    }
    update.mutate({
      is_enabled: enabled,
      max_compensations_per_order: max,
      compensation_cooldown_hours: cooldown,
      compensation_window_days: window,
    });
  };

  const copyBotLink = async () => {
    if (!query.data?.telegram.deepLink) return;
    try {
      await navigator.clipboard.writeText(query.data.telegram.deepLink);
      toast({ title: isArabic ? "تم نسخ رابط البوت." : "Bot link copied." });
    } catch {
      toast({ title: isArabic ? "تعذر نسخ الرابط." : "Could not copy the link.", variant: "destructive" });
    }
  };

  if (query.isLoading) {
    return <div className="space-y-4"><Skeleton className="h-24 w-full" /><Skeleton className="h-64 w-full" /><Skeleton className="h-44 w-full" /></div>;
  }

  const data = query.data;
  const stats = data?.stats ?? { total: 0, successful: 0, partial: 0, failed: 0, pending: 0 };
  const requestStatusLabel = (status: CompensationBotData["recentRequests"][number]["status"]) => {
    if (!isArabic) return status;
    if (status === "SUCCESS") return "ناجح";
    if (status === "PARTIAL") return "جزئي";
    if (status === "FAILED") return "فشل";
    if (status === "PROCESSING") return "جاري التنفيذ";
    return "بالانتظار";
  };

  return (
    <div className="space-y-5 pb-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><Bot className="h-5 w-5" /></span>
            <h1 className="text-2xl font-bold">{copy.title}</h1>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{copy.subtitle}</p>
        </div>
        <Badge className={enabled ? "w-fit bg-emerald-500/10 px-3 py-1.5 text-emerald-700 dark:text-emerald-400" : "w-fit bg-muted px-3 py-1.5 text-muted-foreground"}>
          {enabled ? copy.active : copy.inactive}
        </Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: copy.statsTotal, value: stats.total, icon: History, color: "text-primary" },
          { label: copy.statsSuccess, value: stats.successful + stats.partial, icon: CheckCircle2, color: "text-emerald-600" },
          { label: copy.statsPending, value: stats.pending, icon: Clock3, color: "text-sky-600" },
          { label: copy.statsFailed, value: stats.failed, icon: XCircle, color: "text-rose-600" },
        ].map((item) => (
          <Card key={item.label} className="overflow-hidden">
            <CardContent className="flex items-center justify-between p-4 sm:p-5">
              <div><p className="text-xs text-muted-foreground">{item.label}</p><p className="mt-1 text-2xl font-bold">{item.value}</p></div>
              <item.icon className={`h-6 w-6 ${item.color}`} />
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader>
            <CardTitle>{copy.rules}</CardTitle>
            <CardDescription>{copy.rulesHint}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center justify-between gap-4 rounded-xl border bg-muted/20 p-4">
              <div><p className="font-medium">{enabled ? copy.active : copy.inactive}</p><p className="mt-1 text-xs text-muted-foreground">{copy.activeHint}</p></div>
              <Switch checked={enabled} onCheckedChange={setEnabled} />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="max-compensations">{copy.max}</Label>
                <Input id="max-compensations" type="number" min={0} max={10} inputMode="numeric" value={maxCompensations} onChange={(event) => setMaxCompensations(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cooldown-hours">{copy.cooldown}</Label>
                <div className="relative"><Input id="cooldown-hours" type="number" min={1} max={720} inputMode="numeric" value={cooldownHours} onChange={(event) => setCooldownHours(event.target.value)} className="pe-16" /><span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-xs text-muted-foreground">{copy.cooldownUnit}</span></div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="window-days">{copy.window}</Label>
                <div className="relative"><Input id="window-days" type="number" min={1} max={365} inputMode="numeric" value={windowDays} onChange={(event) => setWindowDays(event.target.value)} className="pe-14" /><span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-xs text-muted-foreground">{copy.windowUnit}</span></div>
              </div>
            </div>
            <Button onClick={save} disabled={update.isPending} className="w-full sm:w-auto">
              {update.isPending ? copy.saving : copy.save}
            </Button>
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader><CardTitle>{copy.botLink}</CardTitle><CardDescription>{copy.botLinkHint}</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              {data?.telegram.deepLink ? <>
                <Input value={data.telegram.deepLink} readOnly dir="ltr" className="text-xs" />
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" onClick={copyBotLink} className="gap-2"><Copy className="h-4 w-4" />{copy.copyLink}</Button>
                  <Button asChild className="gap-2"><a href={data.telegram.deepLink} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" />{copy.openBot}</a></Button>
                </div>
              </> : <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">{copy.missingBot}</p>}
            </CardContent>
          </Card>
          <Card className="border-primary/20 bg-primary/[0.035]">
            <CardContent className="flex gap-3 p-4"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" /><div><p className="text-sm font-semibold">{copy.securityTitle}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{copy.securityHint}</p></div></CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>{copy.recent}</CardTitle><CardDescription>{copy.recentHint}</CardDescription></CardHeader>
        <CardContent>
          {!data?.recentRequests.length ? <p className="py-6 text-center text-sm text-muted-foreground">{copy.empty}</p> : (
            <div className="grid gap-2">
              {data.recentRequests.map((request) => (
                <div key={request.id} className="flex flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
                  <div className="min-w-0"><p className="font-medium">{copy.order} #{request.orderNumber}</p><p className="mt-1 text-xs text-muted-foreground">{copy.attempt} #{request.requestNumber} · {new Date(request.createdAt).toLocaleString(isArabic ? "ar-SA" : "en-US")}</p>{request.error ? <p className="mt-1 truncate text-xs text-rose-600">{request.error}</p> : null}</div>
                  <Badge className={`w-fit ${statusStyle(request.status)}`}>{requestStatusLabel(request.status)}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
