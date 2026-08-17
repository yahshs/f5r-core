import type { Request, Response } from "express";
import { sha256Hex } from "../lib/hash";
import { timingSafeEqualUtf8 } from "../lib/timingSafe";
import {
  getSallaConnectionByPublicWebhookId,
  getSallaWebhookToken,
  isSallaConnectionOperational,
  touchSallaLastEventAtByConnectionId,
} from "../db/sallaConnectionsRepo";
import { insertWebhookEvent } from "../db/webhookEventsRepo";
import { verifySallaWebhookSignature } from "../lib/sallaSignature";

function collectHeaders(req: Request) {
  const keys = [
    "x-salla-event",
    "x-event-name",
    "x-salla-event-id",
    "x-event-id",
    "x-request-id",
    "x-salla-signature",
    "x-salla-signature-256",
    "x-webhook-signature",
    "x-signature",
  ];
  const out: Record<string, string> = {};
  for (const key of keys) {
    const value = req.header(key);
    if (value) out[key] = value;
  }
  return out;
}

function resolveExternalEventId(req: Request) {
  return (
    req.header("x-salla-event-id")?.trim() ||
    req.header("x-event-id")?.trim() ||
    req.header("x-request-id")?.trim() ||
    null
  );
}

function resolveTopic(req: Request, rawBody: string) {
  const fromHeader = (req.header("x-salla-event") || req.header("x-event-name") || "").trim().toLowerCase();
  if (fromHeader) return fromHeader;

  try {
    const payload = JSON.parse(rawBody || "{}");
    const fromBody = String(payload?.event ?? payload?.type ?? "").trim().toLowerCase();
    return fromBody || "unknown";
  } catch {
    return "unknown";
  }
}

export async function handleSallaWebhook(req: Request, res: Response) {
  const publicId = (req.params.publicId || "").trim();
  const rawBody =
    Buffer.isBuffer((req as any).body) ? ((req as any).body as Buffer).toString("utf8") : "";
  const topic = resolveTopic(req, rawBody);
  const payloadBytes = Buffer.byteLength(rawBody || "", "utf8");

  if (!publicId) {
    console.warn("[salla-webhook] missing publicId", { topic, payloadBytes });
    return res.status(404).json({ ok: false });
  }

  const conn = getSallaConnectionByPublicWebhookId(publicId);
  if (!conn) {
    console.warn("[salla-webhook] unknown publicId", { publicId, topic, payloadBytes });
    return res.status(404).json({ ok: false });
  }

  if (conn.connection_mode === "manual") {
    const token = (req.header("x-f5r-webhook-token") || "").trim();
    if (!token) {
      console.warn("[salla-webhook] missing token", { publicId, topic, payloadBytes });
      return res.status(400).json({ ok: false, message: "Missing headers" });
    }

    let expected: string;
    try {
      expected = getSallaWebhookToken(conn);
    } catch {
      console.error("[salla-webhook] token decrypt failed", { sellerId: conn.seller_id, publicId, topic });
      return res.status(500).json({ ok: false, message: "Token storage error" });
    }

    if (!timingSafeEqualUtf8(expected, token)) {
      console.warn("[salla-webhook] invalid token", { sellerId: conn.seller_id, publicId, topic, payloadBytes });
      return res.status(401).json({ ok: false, message: "Unauthorized" });
    }
  } else {
    try {
      const headers = collectHeaders(req);
      if (!verifySallaWebhookSignature(rawBody, headers)) {
        console.warn("[salla-webhook] invalid native signature", {
          sellerId: conn.seller_id,
          publicId,
          topic,
          payloadBytes,
        });
        return res.status(401).json({ ok: false, message: "Unauthorized" });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Signature verification failed";
      console.error("[salla-webhook] native verification error", { sellerId: conn.seller_id, publicId, topic, message });
      return res.status(500).json({ ok: false, message });
    }
  }

  if (!isSallaConnectionOperational(conn)) {
    console.log("[salla-webhook] disabled connection", { sellerId: conn.seller_id, publicId, topic, payloadBytes });
    return res.json({ ok: true, disabled: true });
  }

  // F5R executes orders only when Salla creates the invoice.
  // Acknowledge other events without enqueueing them so Salla will not retry them.
  if (topic !== "invoice.created") {
    console.log("[salla-webhook] ignored topic", { sellerId: conn.seller_id, publicId, topic, payloadBytes });
    return res.json({ ok: true, ignored: true, expected: "invoice.created" });
  }

  const nowIso = new Date().toISOString();
  const payloadHash = sha256Hex(rawBody);
  const externalEventId = resolveExternalEventId(req);
  const eventKey = sha256Hex(
    `${conn.id}|${topic}|${externalEventId || payloadHash}`,
  );
  const headersJson = JSON.stringify(collectHeaders(req));

  try {
    insertWebhookEvent({
      sellerId: conn.seller_id,
      connectionId: conn.id,
      topic,
      eventKey,
      externalEventId,
      payloadRaw: rawBody,
      payloadHash,
      headersJson,
      nowIso,
    });
    touchSallaLastEventAtByConnectionId(conn.id, nowIso);
    console.log("[salla-webhook] enqueued", {
      sellerId: conn.seller_id,
      connectionId: conn.id,
      publicId,
      topic,
      eventKey,
      payloadBytes,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("UNIQUE")) {
      console.log("[salla-webhook] duplicate", { sellerId: conn.seller_id, publicId, topic, eventKey });
      return res.json({ ok: true });
    }
    console.error("[salla-webhook] enqueue failed", { sellerId: conn.seller_id, publicId, topic, eventKey, msg });
    return res.status(500).json({ ok: false, message: "Failed to enqueue" });
  }

  return res.json({ ok: true });
}
