import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import { config } from "@/config/env";
import { useAuthStore } from "@/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const row = z.object({
  id: z.string(),
  order_id: z.string().optional(),
  seller_id: z.string().optional(),
  queue: z.string().optional(),
  last_error: z.string().nullable().optional(),
});
const schema = z.object({
  success: z.boolean(),
  data: z.object({
    submissions: z.array(row),
    refills: z.array(row),
    recoverable: z.array(row),
    statusPolling: z.array(row),
  }),
});
async function request(path: string, body?: unknown) {
  const token = useAuthStore.getState().token;
  const response = await fetch(`${config.API_BASE_URL}/admin/${path}`, {
    method: body ? "POST" : "GET",
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      ...(token && token !== "cookie"
        ? { authorization: `Bearer ${token}` }
        : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result: unknown = await response.json();
  if (!response.ok)
    throw new Error("Operation failed. Refresh and verify the current state.");
  return result;
}
export default function Operations() {
  const { i18n } = useTranslation();
  const ar = i18n.dir() === "rtl";
  const client = useQueryClient();
  const [selected, setSelected] = useState<{ id: string; kind: string } | null>(
    null,
  );
  const [evidence, setEvidence] = useState("");
  const [providerId, setProviderId] = useState("");
  const [outcome, setOutcome] = useState("accepted");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const query = useQuery({
    queryKey: ["operations-reconciliation"],
    queryFn: async () =>
      schema.parse(await request("summary/reconciliation")).data,
    refetchInterval: 30000,
  });
  async function submit() {
    if (!selected || evidence.trim().length < 10) return;
    setSaving(true);
    setError("");
    try {
      if (selected.kind === "submission")
        await request(
          `orders/fulfillments/${encodeURIComponent(selected.id)}/reconcile`,
          { outcome, providerOrderId: providerId || undefined, evidence },
        );
      else if (selected.kind === "refill")
        await request(
          `summary/compensations/${encodeURIComponent(selected.id)}/reconcile`,
          { outcome, evidence },
        );
      else
        await request(
          `summary/recover/${selected.kind}/${encodeURIComponent(selected.id)}`,
          { reason: evidence },
        );
      setSelected(null);
      setEvidence("");
      setProviderId("");
      await client.invalidateQueries({
        queryKey: ["operations-reconciliation"],
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operation failed");
    } finally {
      setSaving(false);
    }
  }
  const groups = query.data
    ? [
        {
          title: ar
            ? "عمليات إرسال غير مؤكدة"
            : "Uncertain provider submissions",
          kind: "submission",
          rows: query.data.submissions,
        },
        {
          title: ar ? "تعويضات غير مؤكدة" : "Uncertain refills",
          kind: "refill",
          rows: query.data.refills,
        },
        {
          title: ar ? "مهام متوقفة" : "Exhausted queue jobs",
          kind: "queue",
          rows: query.data.recoverable,
        },
        {
          title: ar ? "استعلامات الحالة المتوقفة" : "Exhausted status polling",
          kind: "status_poll",
          rows: query.data.statusPolling,
        },
      ]
    : [];
  return (
    <main className="space-y-6 p-6">
      <h1 className="text-2xl font-semibold">
        {ar ? "التشغيل والمراجعة" : "Operations and reconciliation"}
      </h1>
      <p>
        {ar
          ? "تحقق من سجلات المزود قبل تأكيد النتيجة. لا تعيد الإرسال تلقائيًا."
          : "Confirm the outcome from provider records before reconciling. Reconciliation records evidence and never submits a new purchase."}
      </p>
      {query.isLoading && <p role="status">Loading…</p>}
      {query.error && <p role="alert">Unable to load operations.</p>}
      {groups.map((group) => (
        <section key={group.kind} className="space-y-3 rounded-xl border p-4">
          <h2 className="text-lg font-medium">{group.title}</h2>
          {!group.rows.length && (
            <p>{ar ? "لا توجد مهام" : "No jobs awaiting action."}</p>
          )}
          {group.rows.map((item) => (
            <div
              key={item.id}
              className="flex flex-wrap items-center gap-3 border-t py-3"
            >
              <code className="break-all">{item.id}</code>
              <span>{item.last_error}</span>
              <Button
                onClick={() => {
                  setSelected({ id: item.id, kind: item.queue ?? group.kind });
                  setEvidence("");
                  setProviderId("");
                  setOutcome("accepted");
                  setError("");
                }}
              >
                {ar ? "مراجعة" : "Review"}
              </Button>
            </div>
          ))}
        </section>
      ))}
      {selected && (
        <section
          className="space-y-4 rounded-xl border p-4"
          aria-label="Review operation"
        >
          <h2>Review {selected.id}</h2>
          {["submission", "refill"].includes(selected.kind) && (
            <label className="block">
              Confirmed outcome
              <select
                className="ml-3 rounded border bg-background p-2"
                value={outcome}
                onChange={(e) => setOutcome(e.target.value)}
              >
                <option value="accepted">Accepted</option>
                {selected.kind === "refill" && (
                  <option value="partially_accepted">Partially accepted</option>
                )}
                <option value="rejected">Rejected</option>
              </select>
            </label>
          )}
          {selected.kind === "submission" && outcome === "accepted" && (
            <label className="block">
              Confirmed provider order ID
              <Input
                value={providerId}
                onChange={(e) => setProviderId(e.target.value)}
                maxLength={200}
              />
            </label>
          )}
          <label className="block">
            Evidence / recovery reason
            <Textarea
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
              maxLength={2000}
            />
          </label>
          {error && <p role="alert">{error}</p>}
          <Button
            disabled={
              saving ||
              evidence.trim().length < 10 ||
              (selected.kind === "submission" &&
                outcome === "accepted" &&
                !providerId.trim())
            }
            onClick={submit}
          >
            {saving ? "Saving…" : "Record confirmed outcome"}
          </Button>
          <Button variant="outline" onClick={() => setSelected(null)}>
            Cancel
          </Button>
        </section>
      )}
    </main>
  );
}
