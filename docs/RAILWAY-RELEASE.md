# Railway deployment and release checks

These files prepare a deployment; they do not create a Railway service or prove live integration readiness. Push the reviewed changes to GitHub, require the quality/security CI jobs, then connect the repository to a Railway **persistent service**.

## Railway settings

- Builder: Dockerfile detected at the repository root. Keep the custom start command empty so the image entrypoint/CMD runs.
- Runtime: Node 24, frontend served by the Express API on the same origin.
- Attach one persistent volume at `/data`; set `DB_PATH=/data/app.sqlite`. Keep one replica in one region. Do not deploy this SQLite core as a serverless function or scale it across hosts.
- Healthcheck path: `/api/ready`; startup timeout: 300 seconds. Configure restart on failure and at least 25 seconds for shutdown/drain. Configure continuous uptime monitoring separately: deployment healthchecks are not continuous monitoring.
- Start with `WORKERS_ENABLED=0`. For an existing deployment, pause/drain the old worker before changing schema or enabling a replacement. The volume is mounted at startup; do not run volume-dependent migrations or bootstrap in a pre-deploy command.
- Generate a Railway HTTPS domain first, then set `BASE_PUBLIC_URL` to its exact origin with no trailing slash or path. Configure the actual trusted proxy hop count; confirm Railway's current forwarding behavior before accepting client-IP rate-limit evidence. Never trust arbitrary forwarding headers.

The image starts its entrypoint as root only to initialize the fixed volume directory/database ownership, rejects symlinks there, then replaces the process with the Node application as UID 1000. Use the default entrypoint; running a custom start command as root defeats this setup.

Railway now recommends its Infrastructure as Code workflow over deprecated `railway.toml`/`railway.json`. This repository uses automatic Dockerfile detection and the dashboard settings above, avoiding an unlinked project specification that could alter unrelated resources. If managing a project as code later, generate/import its actual configuration with the Railway CLI and review the plan before applying it.

## Variables

Copy variable names from `.env.example` into protected Railway Variables. Generate JWT_SECRET, ENCRYPTION_KEY, SALLA_STATE_SECRET and MONITORING_TOKEN independently. Preserve the existing encryption key and historical keyring when migrating data; replacing them can make existing credentials and backups unreadable. Do not commit an environment file or put secrets into frontend build variables.

Required operational settings:

```text
NODE_ENV=production
DB_PATH=/data/app.sqlite
BASE_PUBLIC_URL=https://<actual-domain>
WORKERS_ENABLED=0
TRUST_PROXY_HOPS=<verified-hop-count>
OUTBOUND_CONCURRENCY=8
ENCRYPTION_KEY_ID=v1
ENCRYPTION_KEYS_JSON={}
```

Provide independent JWT_SECRET, ENCRYPTION_KEY (32-byte hex/base64) and MONITORING_TOKEN (at least 32 bytes). Configure Salla client/redirect/signature values and Telegram token/username/secret for the integrations you intend to enable. Do not set DEMO_PASSWORD. Bootstrap administrator credentials are temporary: run `npm run admin:bootstrap` inside the deployed service with the volume mounted, then remove ADMIN_EMAIL/ADMIN_PASSWORD. Bootstrap cannot modify an existing administrator.

No signing/encryption keys have been generated for your actual deployment in this repository. Store recovery copies outside Railway and test their recovery.

## Configuration preflight

Inside the service or an equivalent protected environment:

```sh
npm run release:preflight
```

This checks production mode, supported Node, canonical HTTPS origin, key encoding/separation, explicit database/proxy/worker configuration, historical key encoding, monitoring secret and enabled integration configuration. Railway environments additionally require an existing volume containing the database path. Output contains only check names and statuses. Failed checks exit unsuccessfully. Disabled integration checks stay pending; passing preflight does not prove strong randomness, correct proxy topology or live sender contracts.

## Backup and restored migration drill

Before modifying an existing service, pause/drain work and take a consistent backup. The new drill opens the source read-only, creates a backup and a restored copy, migrates only the restored copy, checks all original application table counts, foreign keys/integrity and credential decryption:

```sh
npm run release:restore -- /data/app.sqlite /data/release-drill-<unique-date>
```

The output directory must not exist. Run with recovered encryption keys; repeat against a sanitized production-shaped database before release. Protect the output: it contains actual databases, even though report.json contains counts rather than customer fields. Copy backups and key recovery material off the service separately; a backup on the same volume is not disaster recovery. A successful drill with zero encrypted values cannot establish recovery of existing integration credentials.

Use `npm run db:maintenance -- integrity` before/after the actual cutover. Startup applies migrations before serving traffic. Do not roll back old code against the upgraded schema without compatibility review; restores cannot reverse paid provider purchases.

## Continuous monitoring

Configure your monitoring service to probe `/api/ready` over HTTPS every minute; alert after two consecutive failures. Also scrape `/api/metrics` every 30 seconds with `Authorization: Bearer <MONITORING_TOKEN>`. Missing/weak configuration returns 503, incorrect credentials return 401. This endpoint exposes aggregate queue/worker counts and ages, with no tenant identifiers, payloads or raw errors. Store the monitoring token in the monitor's secret store, not in a URL or repository.

For Prometheus, add this job to the existing configuration, substituting the actual domain:

```yaml
scrape_configs:
  - job_name: f5r
    scheme: https
    metrics_path: /api/metrics
    scrape_interval: 30s
    authorization:
      type: Bearer
      credentials_file: /run/secrets/f5r-monitoring-token
    static_configs:
      - targets: ['<actual-domain>:443']
rule_files:
  - /etc/prometheus/f5r-alerts.yml
```

Install `deploy/alerts.yml` in that rule path, validate with `promtool check config`/`promtool check rules`, and route critical/warning alerts through your existing Alertmanager receiver. Receiver installation and test notification require your monitoring account and channel; none has been contacted. Future scheduled jobs are excluded from due-age alerts. Uncertain paid operations and exhausted work require operator review; queue recovery must not blindly reset paid requests.

## Staging contract checks and limited canary

1. Confirm HTTPS, direct SPA routes, login/cookie restoration, logout/revocation, password change, seller denial of admin/other-tenant access, readiness and authenticated metrics. The built application emits a fresh CSP nonce per HTML response for its theme initialization script.
2. Verify native Salla signatures, manual sender header credentials and old-token rejection against actual senders. Verify one-use OAuth state and refresh behavior with a staging installation. Never use a production store as a fixture.
3. Verify Telegram's configured secret, private identity binding and rejection of order-number/public-link access. Confirm who verifies the purchaser and securely delivers the capability.
4. Use a dedicated canary tenant, active subscription, one active product, one bounded rule and one provider. Run read-only service/status calls first and record real currency/charge/state conventions. Confirm the provider supports reconciliation of an uncertain submission.
5. After those checks pass, enable workers only in that staging/canary environment and send exactly one deliberately authorized low-value order through the real ingress. Record the internal job, provider ID, quantity, target, acceptance, eventual delivery and reported charge; compare ledger currency/amount. Do not trigger a refill just to test it without a provider-supported safe canary.
6. If the result is ambiguous, pause work and reconcile using provider evidence; never resend the same paid mutation to obtain a cleaner result. Confirm metrics/alerts, drain and data persistence on a controlled restart before expanding traffic.

The live sender/provider canary remains pending until your service, credentials and intended canary transaction are available. See OPERATIONS.md for operator reconciliation and rollback procedures.

References: [Railway Dockerfiles](https://docs.railway.com/builds/dockerfiles), [volume availability/permissions](https://docs.railway.com/volumes), [healthchecks](https://docs.railway.com/deployments/healthchecks), [Infrastructure as Code](https://docs.railway.com/infrastructure-as-code).
