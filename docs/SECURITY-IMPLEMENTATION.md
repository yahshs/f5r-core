# Security implementation status

Completed: 5 October 2026; assessment started 4 October 2026. Base revision: `c245212ed01255ae9d8f4f8f0d37fb2db671abf4`.

The repository remediation now covers all thirteen planned change areas. The implementation is prepared for repository review and deployment verification. This report distinguishes implemented code and fixture verification from deployment gates that require the target environment. No production database, live paid provider operation or deployment was changed.

## Implemented controls

| Audit finding | Implementation and disposition |
|---|---|
| F01 — stale authorization | Persisted one-hour sessions, explicit signing algorithm/issuer/audience, live account checks, logout revocation, and database session revocation on password/role/disable changes. Deleted identities fail authorization even if subsequently enabled. |
| F02 — customer ownership | Public store codes and order numbers no longer authorize access. Seller-issued, hashed, seven-day order capabilities bind once to one private Telegram identity; lookups and refill callbacks require the grant. Seller must verify the purchaser before delivering the link. |
| F03 — Telegram secret | Missing configuration returns 503; invalid secret returns 401; comparison uses constant time. Malformed update IDs are rejected. |
| F04 — manual Salla rotation | Manual sender must supply the current `X-F5R-Webhook-Token`. Possession of the URL alone fails. Token rotation revokes the previous credential. Native signatures remain required for app mode. |
| F05 — duplicate paid mutations | Provider add/refill requests have no automatic transport retry. Submission intent is persisted before sending. Ambiguous responses, crashes and network failures are quarantined for reconciliation. Administrator confirmation endpoints require evidence and create audit entries. |
| F06 — execution eligibility | Ingestion and execution/refill workers check the current seller role, deletion/disable state, subscription expiry/status and order cancellation/refund policy before paid work. |
| F07 — fail-open routing | Malformed/unsupported conditions fail closed; no-match no longer selects every rule. Quantity integer and configured bounds are checked before submission. |
| F08 — migration loss | Foreign-key toggling happens outside rebuild transactions; legacy rename behavior preserves dependent references. Integrity is checked before commit, enforcement restored afterward, and applied migration checksums detect edits. Populated historical upgrade regression added. |
| F09 — quota races | Transactional, per-order reservations count in-flight orders and existing successful orders once; definitive unsuccessful work releases reservations when no other paid/in-flight work remains. |
| F10 — cancellation race | Worker completion cannot overwrite local cancellation. A received provider acceptance is retained separately. Local cancellation does not cancel an already accepted external order. |
| F11 — SSRF | SMM and refresh transport pins its connection to validated public DNS results while preserving hostname TLS checks. Special IP ranges, URL credentials and non-HTTPS URLs are rejected. DNS lookup has a deadline. |
| F12 — resource abuse | API/auth rate limits, bounded request bodies, outbound response caps and total request deadlines. Proxy trust is explicit. Rate limiter storage is process-local. |
| F13 — stranded queues | Lease recovery and completion fencing for webhook/notification queues; refill/submission uncertainty is quarantined instead of blindly replayed. Automatic retry ceilings and admin queue metrics added. Unknown refill outcomes block additional requests until reconciled. Telegram sends can still be duplicated after a crash because Telegram has no send idempotency key. |
| F14 — plaintext secrets | Secret settings encrypt at rest and are masked in admin reads/writes. Legacy secret settings are encrypted on startup/read. Versioned encryption keys and transactional rekey maintenance added. |
| F15 — OAuth replay | Random, expiring state is bound to the initiating registered session and HttpOnly browser cookie, and consumed once. Callback origin uses configured public URL. |
| F16 — tenant retention | User deletion disables and tombstones the account, retaining execution/financial history. Database triggers reject new orphan/cross-tenant rules and fulfillments. Referenced providers are deactivated rather than deleted. Orders with execution history cannot be deleted through the admin endpoint. Legacy inconsistent records require explicit preflight repair; no silent cleanup. |
| F17 — bootstrap/production | Explicit production startup; strong secret and HTTPS configuration checks; production demo rejection; explicit create-only admin bootstrap. Startup no longer resets existing demo/admin credentials or restores a disabled administrator. |
| F18 — credentials/browser storage | New password minimum 10 characters and maximum 72 UTF-8 bytes, bcrypt cost 12, authenticated change-password API. SPA stores an account hint and cookie sentinel, not JWT credentials. Session cookie is HttpOnly/SameSite Strict and Secure in production. Existing hashes remain usable. |
| F19 — seller Telegram identity | Expiring link codes, code rotation on use, private-chat linking, stored Telegram user identity and callback/session identity checks. Queued notifications re-check current linkage and account eligibility before sending. |
| F20 — Salla lifecycle | Active app connection checks and single-use refresh token rotation with persisted compare-and-swap lock. Interrupted/ambiguous refresh requires reconnect instead of reusing the refresh token. Live refresh/callback verification remains a staging gate. |
| F21 — misleading features | Production payment/ticket mock calls fail explicitly; contact/password-recovery no longer show fabricated delivery; demo login controls are development-only. Billing, support and outgoing recovery/contact email are explicitly unavailable; integrating real services remains a separate project under the agreed plan. |
| F22 — diagnostics | Generic unexpected API errors with request IDs, sanitized integration error redirects and masked secret settings/diagnostics. Explicit tenant retention removes eligible terminal payloads and revokes links while retaining financial/submission evidence. |
| F23 — financial semantics | UI calls local success provider acceptance; summaries and monthly reports separate currencies and exclude cancellation/refund invoice totals; missing FX does not imply parity. Immutable events record acceptance and cost estimates with currency minor units. Read-only delivery polling records provider-reported charges and reversal deltas idempotently in the ledger; dashboards show invoice, estimated and provider-reported amounts separately by currency. Bank settlement requires a real payment/accounting integration. |
| F24 — admin tenant mutation | Admin rule edits validate provider ownership; database triggers enforce product/rule/provider/fulfillment tenant relationships for new writes. |

SQLite does not implement native row-level security. These changes strengthen application RBAC, seller predicates and database ownership constraints; they do not create PostgreSQL RLS. Administrators still have broad system privileges. Fine-grained administrator permissions and MFA require a separately defined privilege model.

## Completion of the thirteen changes

| Plan change | Final implementation |
|---|---|
| 1. Supported runtime and regression foundation | Node 24 CI, reproducible lockfile, isolated/mocked external side effects, maintained auth, tenant, network, submission and upgrade probes. Native SQLite driver upgraded to 13.0.3 after supported-runtime verification exposed a cleanup crash in 11.10.0. |
| 2. Migration safety | Checksums, rebuild FK discipline, immediate transaction/recheck under the migration write lock, populated historical upgrade tests and encrypted restore verification. |
| 3. Authentication | Live RBAC/account checks, registered expiring sessions, revocation, HttpOnly cookies, no browser JWT persistence, explicit bootstrap, password policy and bilingual desktop/mobile password-change UI. |
| 4. Authenticated ingress | Fail-closed Telegram secret, valid/deduplicated update IDs, native Salla signature and current manual token, corrected WordPress relay. |
| 5. Purchaser identity | Seller-issued hashed expiring capability binds to one private Telegram user; callbacks and notifications recheck current identity and ownership. |
| 6. Paid mutation safety | Durable attempts and NONE/SENDING/UNKNOWN/ACCEPTED states, lease fencing, cancellation preservation and evidence-required admin reconciliation UI/API. No paid transport replay. |
| 7. Execution policy | Rechecks immediately before mutations, transactional per-order quota reservations, fail-closed conditions, frozen rule/provider/input configuration, bounds and provider-acceptance sequencing. |
| 8. Durable queues | Leases/recovery, ordinary retry ceilings, graceful drain, read-only status polling with backoff/exhaustion and audited dead-letter recovery UI. Unknown refills block new allowance. |
| 9. Ownership and retention | Migrations enforce tenant ownership, roles, quantities, JSON and states; referenced financial identities cannot be hard-deleted. Explicit dry-run-first tenant payload retention preserves execution and financial evidence. |
| 10. Credentials and lifecycle | Encrypted/masked settings, versioned keyring/rekey, browser/session-bound one-use OAuth state, serialized refresh and ambiguous refresh quarantine. Provider deletion preserves history. |
| 11. Network and abuse | DNS validation and connection pinning, HTTPS-only/provider IP restrictions, bounded bodies/responses/deadlines, finite outbound concurrency, account/IP/Telegram identity budgets and explicit proxy trust. |
| 12. Reporting and product honesty | Immutable currency-aware charge/adjustment events, configured estimate metadata, independent delivery state, currency-separated dashboard summaries and explicit unsupported feature states. |
| 13. Code quality and operations | Zero-error/warning full lint, strict production TypeScript, shared/batched order mapping, SQL pagination/aggregation, parsing extracted from orchestration, readiness/worker metrics, restore/load drills, runbook and current setup docs. |

All 24 audit findings have an implementation or explicit disposition in the table above. SQLite remains the selected database: it has no native RLS. Routes and repositories enforce administrator/seller roles, current identity and tenant predicates; database triggers enforce ownership across related rows. A PostgreSQL RLS migration, finer administrator privilege model and MFA remain separately scoped projects. The broad administrator role is deliberate and must be assigned only to trusted operators.

## Data and workflow compatibility

Migrations 042–047 introduce sessions, capabilities, OAuth transactions, submission attempts, quota reservations, leases, financial events, snapshots, polling and ownership/validation guards. Historical inconsistent records are retained for reviewed repair; new inconsistent writes fail. Older migration checksums receive a compatibility baseline on first upgrade, which cannot prove historical SQL was never changed before that baseline.

Old JWTs without a registered session/required claims are invalid. Users must sign in again. Browser clients require a shared frontend/API origin; programmatic Bearer clients retain their API contract. Sessions expire after one hour. Password changes revoke other sessions and return a replacement cookie. Demo users are development-only and never reset existing accounts.

Manual senders must migrate to the current header token. Telegram must present the configured secret. Customer links require trusted purchaser verification before delivery. Seven-day links bind on first use, so possession must be protected.

New jobs freeze the original rule, provider endpoint, configured FX and usable buyer inputs. Missing invoice inputs can be enriched; existing inputs cannot be replaced. Legacy snapshots are reconstructed from upgrade-time configuration, not unknowable original configuration. Jobs without a bound original rule stop for review. Later execution ranks wait for provider acceptance of earlier ranks; this does not wait for delivery completion. Local cancellation preserves evidence of any external acceptance.

Delivery polling is read-only. Provider status responses append reported charge deltas and reversals by currency, with idempotency and lease fencing. Missing currency/rates remain unknown. Provider-reported amounts do not prove bank settlement. Invoice totals exclude cancelled/refunded orders and do not represent collected cash; invoice margin uses estimates and is not net profit. Ledger summaries cover their stated period and separate estimated from reported values. Polling completed orders daily permits later credits to be observed; changed currency requires review.

## Verification evidence

The original baseline had 178 tests, 40 dependency advisories and 413 lint errors/21 warnings. The current test setup no longer depends on the Node web-storage flag. Strict checks cover frontend and production server code; test files are run by Vitest and linted, but are excluded from the production server typecheck.

Final supported-runtime command results are recorded outside the repository in `D:\f5r-updated\node24-{install,lint,typecheck,tests,build,load}.log` and `node24-audit.json`. Verification uses an isolated source copy installed from the lockfile on Node 24.21.0. The workspace dependencies were then installed from the same lockfile on Node 24. Final workspace lint/typecheck/test/build logs are named `workspace-final-*.log`. The host system drive filled during validation; task temporary files/cache were moved to the workspace drive. Tests ran with one worker to limit host resource use. Early failed runs remain superseded by the final successful run, not counted as passes.

| Check | Result |
|---|---|
| Node 24 clean installation | Pass, native SQLite available from the current lockfile |
| Complete suite | 259 tests pass across 35 files; 81 additional tests over baseline |
| Repository-wide lint | Pass with zero errors/warnings; CI uses the complete lint command |
| Strict web/server typechecks | Pass |
| Production build | Pass on Node 24 |
| Dependency audit | Zero reported vulnerabilities at verification time |
| Historical populated upgrade and current populated encrypted restore | Pass in maintained tests: counts, FK/integrity, attempts, sessions, financial rows, snapshots and recovered-key decryption |
| SQL/filtering benchmark | 10,000 orders across two tenants; 60 filtered authenticated requests with 100 orders per page, plus readiness requests, checked against local p95 targets of 500 ms/100 ms; measured p95 59.61 ms / 6.62 ms on Node 24; query plan uses the tenant/created index |
| Browser checks | Admin/seller login and protected navigation, cookie restoration, absence of a readable session cookie/stored JWT, password change, admin-only routing, reconciliation/recovery audit entries, products/categories/analytics pages and Arabic mobile navigation |

Maintained fault probes cover DNS connection pinning, response caps/deadlines, no paid retry, bounded concurrency, refresh serialization/quarantine, frozen submission inputs, sequential predecessor failure/uncertainty, duplicate/adjusted charges, currency precision (JPY/KWD), cancellation and stale leases, owner-scoped SQL parity, invalid database writes, admin-only queue recovery, explicit retention and stopping a refill after lease loss or account ineligibility. No external paid calls or Telegram delivery are used by these tests.

Browser evidence uses an isolated fixture database with workers paused. Fresh mobile navigation produced no browser errors or console warnings after correcting its dialog description. Screenshots are saved under `D:\f5r-updated\browser-*.png`. This is targeted flow and visual verification, not a comprehensive accessibility audit or real provider contract certification.

## External release gates and explicit dispositions

No local implementation items from the thirteen-change remediation remain intentionally deferred. Production readiness still requires evidence from the actual deployment:

1. Inspect deployed configuration, persistent volume, trusted proxy topology and key backups. Run a populated upgrade/restore drill against a sanitized production-shaped copy and inspect legacy ownership/currency/snapshot anomalies.
2. Configure external monitoring to consume implemented readiness/queue/worker metrics and the runbook's initial alert thresholds. Agree production capacity targets; the local fixture benchmark does not establish availability or peak throughput.
3. Verify real Salla OAuth/refresh/native signatures, manual relay header rotation and Telegram secret delivery. Reconnect interrupted installations and invalidate old credentials/sessions.
4. Verify the trusted channel delivering purchaser capabilities. Confirm actual provider status/charge semantics and reconciliation evidence, then run a limited canary before expanding submissions.
5. Approve the retention period and permissible data minimization. The implemented command selectively removes terminal payload/linkage; it is not full legal anonymization or deletion of financial evidence.
6. Follow coordinated pause/drain, single migration owner, schema-compatible rollback and external-side-effect reconciliation. A restored database cannot reverse a provider purchase.

Billing, ticket delivery and outgoing recovery/contact email remain explicitly unavailable until real providers are integrated, as permitted by Change 12. PostgreSQL RLS, shared multi-host rate limiting and MFA/fine-grained administrator permissions require separate architecture/product decisions. See OPERATIONS.md for concrete commands and rollback procedures.

Technical references used for the final network/runtime review: [IANA IPv4 special-purpose ranges](https://www.iana.org/assignments/iana-ipv4-special-registry), [IANA IPv6 special-purpose ranges](https://www.iana.org/assignments/iana-ipv6-special-registry), and [better-sqlite3 N-API release](https://github.com/WiseLibs/better-sqlite3/releases/tag/v13.0.0).

## Railway release preparation — 5 October 2026

Following the requested production-readiness work, the user chose to push to GitHub and deploy to Railway later. No hosting project was linked or deployed. Added a multi-stage Node 24 Docker image, fixed-volume initialization with privilege drop, secret/database build exclusions, a Linux container startup/volume/shutdown CI job, and docs/RAILWAY-RELEASE.md with the required Railway settings and staged canary sequence.

Added `release:preflight` (safe configuration statuses), `release:restore` (read-only source backup, migrated restored copy, all original application table counts, integrity/FK and recovered-key decryption), and protected `/api/metrics` with aggregate queue ages/counts, uncertain operations, exhausted jobs and worker health. `deploy/alerts.yml` supplies Prometheus alert rules; actual receiver configuration/delivery still needs the monitoring environment.

Production serving now injects a per-response CSP nonce into noncached SPA HTML and passes it to the theme library's initialization script. This resolves a production-only inline-script conflict without allowing arbitrary inline scripts. New regression tests cover matching/unique nonces, direct SPA routes, missing/weak/incorrect metrics credentials, no private fields in metrics and future scheduled work excluded from due-age metrics.

Verification: 259 tests / 35 files pass on Node 24; full lint, strict typechecks and production build pass. Valid preflight fixtures pass and invalid HTTP configuration fails. The populated restore drill preserves all original table counts, including submission attempts, and decrypts a credential with the recovered fixture key. Local HTTPS production-browser login/reload, cookie secrecy, absence of stored JWT, theme/CSP nonce matching, readiness and unauthorized metrics checks pass with no console errors. Logs are `D:\f5r-updated\railway-*.log`; browser evidence is under `D:\f5r-updated\production-smoke`.

The local Docker daemon did not respond, so Linux image build/runtime checks remain unexecuted here and must pass in the new GitHub CI container job. YAML files parse and the entrypoint passes shell syntax checks. These local fixtures are not production data or real integration certifications. After deployment, the remaining gates are actual volume/key restoration, sender/OAuth/Telegram contracts, proxy/capacity evidence, external alert delivery, trusted purchaser delivery and one deliberately authorized provider canary.
