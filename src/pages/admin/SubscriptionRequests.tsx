import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { useAdminSubscriptionRequests, useReviewAdminSubscriptionRequest } from "@/hooks/useApi";
import type { AdminUpgradeRequest } from "@/api/adminSubscriptionRequests";

function statusBadge(status: AdminUpgradeRequest["status"]) {
  if (status === "PENDING") return <Badge variant="secondary">PENDING</Badge>;
  if (status === "APPROVED") return <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">APPROVED</Badge>;
  return <Badge className="bg-rose-500/10 text-rose-700 dark:text-rose-400">REJECTED</Badge>;
}

export default function AdminSubscriptionRequestsPage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<AdminUpgradeRequest["status"] | "ALL">("PENDING");
  const requestsQuery = useAdminSubscriptionRequests({
    status: status === "ALL" ? undefined : status,
    limit: 200,
  });
  const reviewMutation = useReviewAdminSubscriptionRequest();

  const [selected, setSelected] = useState<AdminUpgradeRequest | null>(null);
  const [note, setNote] = useState("");
  const [decision, setDecision] = useState<"APPROVED" | "REJECTED">("APPROVED");

  const rows = requestsQuery.data ?? [];

  const selectedCreatedAt = useMemo(() => {
    if (!selected) return "";
    try {
      return new Date(selected.createdAt).toLocaleString();
    } catch {
      return selected.createdAt;
    }
  }, [selected]);

  const submitReview = async () => {
    if (!selected) return;
    try {
      await reviewMutation.mutateAsync({ id: selected.id, patch: { status: decision, note: note || undefined } });
      toast({ title: t("common.success"), description: t("admin.subscriptionRequests.toasts.reviewed") });
      setSelected(null);
      setNote("");
    } catch (e: any) {
      toast({ title: t("common.error"), description: e.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("admin.subscriptionRequests.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("admin.subscriptionRequests.subtitle")}</p>
        </div>
        <div className="w-full sm:w-56">
          <Select value={status} onValueChange={(v) => setStatus(v as any)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="PENDING">PENDING</SelectItem>
              <SelectItem value="APPROVED">APPROVED</SelectItem>
              <SelectItem value="REJECTED">REJECTED</SelectItem>
              <SelectItem value="ALL">ALL</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("admin.subscriptionRequests.listTitle")}</CardTitle>
          <CardDescription>{t("admin.subscriptionRequests.listHint")}</CardDescription>
        </CardHeader>
        <CardContent>
          {requestsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("admin.subscriptionRequests.empty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("admin.subscriptionRequests.fields.status")}</TableHead>
                    <TableHead>{t("admin.subscriptionRequests.fields.seller")}</TableHead>
                    <TableHead>{t("admin.subscriptionRequests.fields.currentPlan")}</TableHead>
                    <TableHead>{t("admin.subscriptionRequests.fields.requestedPlan")}</TableHead>
                    <TableHead>{t("admin.subscriptionRequests.fields.createdAt")}</TableHead>
                    <TableHead className="text-right">{t("admin.subscriptionRequests.fields.actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{statusBadge(r.status)}</TableCell>
                      <TableCell className="max-w-[240px]">
                        <div className="truncate font-medium">{r.sellerName}</div>
                        <div className="truncate text-xs text-muted-foreground">{r.sellerEmail}</div>
                      </TableCell>
                      <TableCell>{r.currentPlan}</TableCell>
                      <TableCell>{r.requestedPlan}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(r.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSelected(r);
                            setDecision("APPROVED");
                            setNote("");
                          }}
                        >
                          {t("admin.subscriptionRequests.review")}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-h-[85vh] w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("admin.subscriptionRequests.reviewTitle")}</DialogTitle>
            <DialogDescription>{t("admin.subscriptionRequests.reviewHint")}</DialogDescription>
          </DialogHeader>

          {selected ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">{t("admin.subscriptionRequests.fields.seller")}</p>
                  <p className="mt-1 text-sm font-medium">{selected.sellerName}</p>
                  <p className="text-xs text-muted-foreground">{selected.sellerEmail}</p>
                  <p className="text-xs text-muted-foreground">{selected.sellerPhone ?? "-"}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">{t("admin.subscriptionRequests.fields.createdAt")}</p>
                  <p className="mt-1 text-sm">{selectedCreatedAt}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">{t("admin.subscriptionRequests.fields.currentPlan")}</p>
                  <p className="mt-1 text-sm">{selected.currentPlan}</p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">{t("admin.subscriptionRequests.fields.requestedPlan")}</p>
                  <p className="mt-1 text-sm">{selected.requestedPlan}</p>
                </div>
              </div>

              <div className="space-y-2">
                <Label>{t("admin.subscriptionRequests.decision")}</Label>
                <Select value={decision} onValueChange={(v) => setDecision(v as any)}>
                  <SelectTrigger className="w-full sm:w-60">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="APPROVED">APPROVED</SelectItem>
                    <SelectItem value="REJECTED">REJECTED</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>{t("admin.subscriptionRequests.note")}</Label>
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("admin.subscriptionRequests.notePlaceholder")} />
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button variant="outline" onClick={() => setSelected(null)}>
                  {t("common.cancel")}
                </Button>
                <Button onClick={submitReview} disabled={reviewMutation.isPending}>
                  {reviewMutation.isPending ? t("common.loading") : t("admin.subscriptionRequests.submit")}
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

