import { asRecord } from '../lib/unknownValue';
import type { Request, Response } from "express";
import { sha256Hex } from "../lib/hash";
import {
  getSallaConnectionByPublicWebhookId,
  isSallaConnectionOperational,
  touchSallaLastEventAtByConnectionId,
  getSallaWebhookToken,
} from "../db/sallaConnectionsRepo";
import { timingSafeEqualUtf8 } from "../lib/timingSafe";
import { getUserById } from "../db/usersRepo";
import { insertWebhookEvent } from "../db/webhookEventsRepo";
import { verifySallaWebhookSignature } from "../lib/sallaSignature";
import { parseWebhookPayloadRaw } from "../lib/sallaWebhookPayload";

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

function resolveTopic(req: Request, payload: unknown) {
  const fromHeader = (req.header("x-salla-event") || req.header("x-event-name") || "").trim().toLowerCase();
  if (fromHeader) return fromHeader;

  const fromBody = String(asRecord(payload)?.event ?? asRecord(payload)?.type ?? "").trim().toLowerCase();
  return fromBody || "unknown";
}

export async function handleSallaWebhook(req: Request, res: Response) {
  const publicId = typeof req.params.publicId === "string" ? req.params.publicId.trim() : "";
  const rawBody =
    Buffer.isBuffer((asRecord(req)).body) ? ((asRecord(req)).body as Buffer).toString("utf8") : "";
  let payload: unknown;
  let parseError: string | null = null;
  try {
    payload = parseWebhookPayloadRaw(rawBody);
  } catch (error) {
    parseError = error instanceof Error ? error.message : "Invalid webhook payload";
  }
  const topic = resolveTopic(req, payload);
  const payloadBytes = Buffer.byteLength(rawBody || "", "utf8");

  if (!publicId) {
    console.warn("[salla-webhook] missing publicId", { topic, payloadBytes });
    return res.status(404).json({ ok: false });
  }

  const conn = getSallaConnectionByPublicWebhookId(publicId);
  if (!conn) {
    console.warn("[salla-webhook] unknown publicId", { topic, payloadBytes });
    return res.status(404).json({ ok: false });
  }

  if (conn.connection_mode === "app") {
    try {
      const headers = collectHeaders(req);
      if (!verifySallaWebhookSignature(rawBody, headers)) {
        console.warn("[salla-webhook] invalid native signature", {
          sellerId: conn.seller_id,
          topic,
          payloadBytes,
        });
        return res.status(401).json({ ok: false, message: "Unauthorized" });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Signature verification failed";
      console.error("[salla-webhook] native verification error", { sellerId: conn.seller_id, topic, message });
      return res.status(500).json({ ok: false, message });
    }
  } else {
    const supplied = req.header("x-f5r-webhook-token") || "";
    if (!supplied || !timingSafeEqualUtf8(supplied, getSallaWebhookToken(conn))) return res.status(401).json({ ok: false, message: "Unauthorized" });
  }

  const seller = getUserById(conn.seller_id);
  if (!seller || seller.is_disabled || seller.role !== "seller") return res.status(403).json({ ok: false });

  if (!isSallaConnectionOperational(conn)) {
    console.log("[salla-webhook] disabled connection", { sellerId: conn.seller_id, topic, payloadBytes });
    return res.json({ ok: true, disabled: true });
  }

  if (parseError) {
    return res.status(400).json({ ok: false, message: parseError });
  }

  // F5R executes orders only when Salla creates the invoice.
  // Acknowledge other events without enqueueing them so Salla will not retry them.
  if (topic !== "invoice.created") {
    console.log("[salla-webhook] ignored topic", { sellerId: conn.seller_id, topic, payloadBytes });
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
      topic,
      eventKey,
      payloadBytes,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("UNIQUE")) {
      console.log("[salla-webhook] duplicate", { sellerId: conn.seller_id, topic, eventKey });
      return res.json({ ok: true });
    }
    console.error("[salla-webhook] enqueue failed", { sellerId: conn.seller_id, topic, eventKey, msg });
    return res.status(500).json({ ok: false, message: "Failed to enqueue" });
  }

  return res.json({ ok: true });
}
