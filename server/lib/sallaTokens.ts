import crypto from "node:crypto";
import { getDb } from "../db/db";
import {
  getSallaAccessToken,
  getSallaConnectionById,
  isSallaConnectionOperational,
  type SallaConnectionRow,
} from "../db/sallaConnectionsRepo";
import { z } from "zod";
import { decryptSecret, encryptSecret } from "./encryption";
import { postFormUrlEncoded } from "./httpClient";
import { assertPublicHttpsUrl } from "./ssrf";

/** Salla refresh tokens are single-use. An interrupted refresh requires reconnect, never replay. */
export async function getFreshSallaAccessToken(connection: SallaConnectionRow) {
  if (!isSallaConnectionOperational(connection)) return null;
  if (
    !connection.token_expires_at ||
    Date.parse(connection.token_expires_at) > Date.now() + 60000
  )
    return getSallaAccessToken(connection);
  if (!connection.refresh_token_encrypted)
    throw new Error("Salla reconnect required");
  const lock = crypto.randomUUID();
  const db = getDb();
  const acquired = db
    .prepare(
      "UPDATE salla_connections SET refresh_lock=? WHERE id=? AND refresh_lock IS NULL AND refresh_token_encrypted=? AND status='active'",
    )
    .run(lock, connection.id, connection.refresh_token_encrypted);
  if (!acquired.changes) {
    const fresh = getSallaConnectionById(connection.id);
    if (
      fresh?.token_expires_at &&
      Date.parse(fresh.token_expires_at) > Date.now() + 60000
    )
      return getSallaAccessToken(fresh);
    throw new Error(
      "Salla token refresh in progress or reconciliation required",
    );
  }
  try {
    const url = assertPublicHttpsUrl(
      new URL(
        "/oauth2/token",
        process.env.SALLA_AUTH_BASE_URL || "https://accounts.salla.sa",
      ).toString(),
    );
    const result = await postFormUrlEncoded(
      url,
      {
        grant_type: "refresh_token",
        refresh_token: decryptSecret(connection.refresh_token_encrypted),
        client_id: process.env.SALLA_CLIENT_ID || "",
        client_secret: process.env.SALLA_CLIENT_SECRET || "",
      },
      { retries: 0, timeoutMs: 10000 },
    );
    const data = z
      .object({
        access_token: z.string().min(1).max(16384),
        refresh_token: z.string().min(1).max(16384),
        expires_in: z.coerce.number().finite().positive().optional(),
        expires: z.coerce.number().finite().positive().optional(),
      })
      .parse(JSON.parse(result.bodyText));
    if (result.status >= 400 || !data.access_token || !data.refresh_token)
      throw new Error("Salla reconnect required");
    const expires = data.expires_in
      ? Date.now() + Number(data.expires_in) * 1000
      : Number(data.expires) * 1000;
    if (!Number.isFinite(expires) || expires <= Date.now())
      throw new Error("Invalid Salla token expiry");
    const updated = db
      .prepare(
        "UPDATE salla_connections SET access_token_encrypted=?,refresh_token_encrypted=?,token_expires_at=?,refresh_lock=NULL,updated_at=? WHERE id=? AND refresh_lock=? AND status='active'",
      )
      .run(
        encryptSecret(data.access_token),
        encryptSecret(data.refresh_token),
        new Date(expires).toISOString(),
        new Date().toISOString(),
        connection.id,
        lock,
      );
    if (!updated.changes)
      throw new Error("Salla connection changed while refreshing");
    return data.access_token;
  } catch {
    db.prepare(
      "UPDATE salla_connections SET status='error' WHERE id=? AND refresh_lock=?",
    ).run(connection.id, lock);
    throw new Error("Salla reconnect required after token refresh failure");
  }
}
