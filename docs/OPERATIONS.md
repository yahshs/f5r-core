# Security cutover and recovery

## Preparation

Use Node 24 (CI baseline) and persistent storage. Copy `.env.example` into a protected runtime environment, configure independent high-entropy JWT/encryption/OAuth secrets and the public HTTPS origin. Preserve the existing encryption key for existing credentials. Set `WORKERS_ENABLED=0` until preflight and ingress cutover succeed. Configure `TRUST_PROXY_HOPS` to the actual trusted proxy topology; do not trust arbitrary forwarding headers.

Inspect production data and integration sender contracts before deploying. The local restore test proves the mechanism on fixture data, not the availability of production backups or keys.

## Database preflight and backup

Stop/drain the old service and ensure there is one migration owner. Run these commands with `DB_PATH` pointing to the intended database and the correct encryption key environment:

```text
npm run db:maintenance -- integrity
npm run db:maintenance -- backup <new-absolute-backup-path>
npm run migrate
npm run db:maintenance -- integrity
```

`integrity` exits unsuccessfully for SQLite corruption, broken foreign keys, duplicate normalized emails/default providers/pending retries, orphan sellers and cross-tenant rules. Repair flagged records through a reviewed data repair plan; do not delete execution evidence to make a check green. Preflight assumes the application's existing schema is present. New empty databases should run migrations first.

`backup` uses SQLite's consistent online backup API and refuses an existing target. Protect and copy encryption keys separately. Restore the backup into an isolated location, run integrity checks, compare important table counts and prove credential decryption with the recovered key before release. Never restore over a running service's WAL database.

## Authentication and ingress cutover

All old JWT sessions require sign-in again. Cookies require the frontend and API to share an origin. Explicitly create an initial administrator only when needed:

```text
npm run admin:bootstrap
```

The bootstrap command reads `ADMIN_EMAIL` and a policy-compliant `ADMIN_PASSWORD`, refuses an existing account and never re-enables an existing administrator. Remove bootstrap credentials from the runtime environment afterward.

Manual Salla/WordPress senders must supply `X-F5R-Webhook-Token` using the current rotated credential; URL-only delivery will be rejected. Native Salla requests still require their configured signature. Telegram must send the configured `X-Telegram-Bot-Api-Secret-Token`. Reconnect Salla installations if refresh was interrupted. Verify these flows in staging before allowing real submissions.

Customer Telegram access now requires a private order link generated from the seller order detail. Deliver only to a verified purchaser. Links expire in seven days and bind to the first private Telegram user. Public store links and order numbers do not grant access.

## Queue monitoring and reconciliation

Check `/api/health`, `/api/ready` and authenticated administrator `GET /api/admin/summary/operations`. Monitor overdue/exhausted work and unknown provider outcomes. Queue retry ceilings are 20 for ordinary retryable jobs; uncertain paid operations require review regardless of attempt count. Notifications can duplicate after an interrupted send and must not be represented as exactly-once delivery.

For an unknown submission, verify with the provider whether it accepted the request, then call authenticated administrator:

```text
POST /api/admin/orders/fulfillments/<id>/reconcile
{"outcome":"accepted","providerOrderId":"confirmed-id","evidence":"Provider support or API confirmation reference"}
```

For confirmed rejection use `outcome: "rejected"` and evidence. This enables deliberate manual retry; it does not automatically resubmit. An accepted result on a locally cancelled job retains local cancellation and external acceptance evidence.

For uncertain refills, verify **every** submitted provider operation, then call:

```text
POST /api/admin/summary/compensations/<id>/reconcile
{"outcome":"accepted","evidence":"Confirmation covering every provider refill in this request"}
```

Other outcomes are `partially_accepted` and `rejected`. Accepted/partial requests retain used compensation allowance; confirmed rejection releases it subject to cooldown. Original provider results remain stored, reconciliation adds evidence and an audit entry. Operators must never infer rejection from a timeout alone.

## Key rotation, rollback and release gates

Set a fresh current `ENCRYPTION_KEY` and distinct `ENCRYPTION_KEY_ID`, preserve historical keys in `ENCRYPTION_KEYS_JSON`, then run `npm run db:maintenance -- rekey`. Verify credential reads; keep old keys for retained backups. Never change only the key and discard the previous one.

SIGTERM/SIGINT stops new worker batches and waits up to 15 seconds for active work; an unsuccessful drain exits unsuccessfully. Interrupted paid work remains subject to uncertainty reconciliation. Do not restart an old application that blindly retries that work.

Rollback must consider both the migrated schema and real external side effects. A database restore cannot undo accepted provider orders. Reconcile operations since the backup before any replay. Keep the new ingress/auth boundaries during rollback, or pause ingress entirely.

Before release, require target-environment CI, sanitized production-shaped migration/restore checks, sender credential validation, production load targets and a provider canary. Local implementation and validation evidence are listed in `SECURITY-IMPLEMENTATION.md`.

## Delivery polling, sequencing and dead-letter recovery

The admin Operations page lists uncertain paid submissions/refills and exhausted ordinary queues/status polls. Confirmation requires provider evidence; acceptance also requires the confirmed provider order ID. Recovery of exhausted webhooks, notifications and read-only polls requires an audited reason. It never resets a paid submission or refill for blind replay. API recovery is `POST /api/admin/summary/recover/:queue/:id` with `{ "reason": "Configuration repaired and reviewed" }`; allowed queue values are defined by the Operations API/UI.

Original job configuration, provider endpoint, FX metadata and usable buyer inputs are frozen at enqueue. Legitimately missing buyer inputs may be enriched from stored invoices or authenticated Salla reads; populated inputs cannot be silently replaced. Legacy snapshots reconstructed on upgrade describe the upgrade-time configuration, not unknowable historical values. Jobs with no bound original rule stop for operator review. Endpoint changes require explicit review. Lower execution ranks must have provider acceptance before later ranks submit; equal ranks can run in parallel. This sequences acceptance, not final delivery.

Read-only status polling tracks delivery independently from local job status. Provider-reported charges and adjustments append immutable ledger events by currency. Rate estimates, invoices and provider-reported totals have different bases and periods; none establishes bank settlement or net profit. Currency changes stop automated financial reconciliation for review. Completed orders are polled daily to catch later adjustments; repeated failures back off and exhaust at 100. Poll recovery is read-only. Rate limiting is process-local, and outbound capacity defaults to 8 with bounded queueing. SQLite deployments require persistent storage and a controlled service topology; multiple hosts need shared throttling and a separately tested coordination architecture.

## Monitoring thresholds

Connect authenticated operations metrics to the deployment's monitoring system. Suggested initial thresholds: immediate alert for any uncertain paid operation or exhausted job; immediate readiness failure alert; warning when the oldest ordinary ready queue job exceeds five minutes; critical at fifteen minutes; warning for sustained auth/signature rejection spikes or queue growth over ten minutes. Exclude intentionally scheduled future work. Tune these thresholds to the production workload and provider latency. Metrics and worker heartbeat/readiness are implemented; external alert delivery requires the target monitoring service.

## Retention

Hard deletion of an identity with execution/financial history is blocked. The maintenance retention command defaults to a dry run for an already disabled, tombstoned tenant:

```text
npm run db:maintenance -- retention <seller-id> <approved-days>
npm run db:maintenance -- retention <seller-id> <approved-days> --apply --confirm=<seller-id> --reason=<review-reference>
```

Apply requires an explicit tenant confirmation and a reason of at least ten characters. It refuses unresolved paid/refill work, removes eligible old terminal ingress/notification payloads and bot linkage, revokes sessions/customer grants/OAuth transactions, and preserves invoice, submission, financial and audit evidence. This is selective payload retention, not comprehensive anonymization. Approve retention duration and legal/audit requirements before using it on production data; no automatic destructive purge runs.

## Final local evidence and remaining release gates

Repository-wide lint, strict web/server checks, the full regression suite, Node 24 runtime validation, isolated populated encrypted restore and the maintained 10,000-order benchmark are recorded in SECURITY-IMPLEMENTATION.md. Before deployment, validate a sanitized production-shaped backup with recovered keys, configure monitoring, verify actual Salla/Telegram/manual sender contracts and provider charge/status semantics, securely deliver purchaser capabilities, and run a limited provider canary. These target-environment checks cannot be inferred from local fixtures. Do not restore or roll back blindly after external acceptance: a database restore cannot undo a paid provider operation.

## Railway deployment preparation

Use [RAILWAY-RELEASE.md](RAILWAY-RELEASE.md) for the image, volume, healthcheck and protected metrics setup. Configuration checks are `npm run release:preflight`; restored migration/key drills are `npm run release:restore -- <existing-absolute-source-db> <new-absolute-output-directory>`. Protected aggregate metrics are at `/api/metrics` using the independent MONITORING_TOKEN bearer credential. Prometheus rules are in `deploy/alerts.yml`; receivers must be configured and tested in the intended monitoring service.
