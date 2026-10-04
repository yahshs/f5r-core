# Setup

## Local development

Install Node 24 LTS, then run `npm ci`. The supported engine range also allows Node 22.12+, but Node 24 is the tested CI baseline. Native SQLite bindings must be installed with the selected Node version; do not reuse `node_modules` across incompatible runtimes.

Create a protected `.env` with `NODE_ENV=development`, `PORT=8787`, `BASE_PUBLIC_URL` matching the frontend origin, `DB_PATH=./.data/app.sqlite`, and independent `JWT_SECRET` and `ENCRYPTION_KEY`. Generate each secret independently:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

The encryption key must encode 32 bytes as hex or base64. Keep `WORKERS_ENABLED=0` when inspecting data without executing queued work. Optional development-only `DEMO_PASSWORD` creates absent demo accounts; it never changes an existing account. Never set it in production.

```sh
npm run dev:full
```

The frontend proxies `/api` to the API so session cookies use the same origin. The SPA stores a user hint, with authentication in an HttpOnly cookie. Cross-origin frontend/API hosting needs an explicitly designed cookie/origin configuration.

## Production configuration

Use `.env.example` as the variable inventory. Set `NODE_ENV=production`, a persistent absolute `DB_PATH`, public HTTPS `BASE_PUBLIC_URL`, independent JWT/encryption/OAuth secrets, and the exact trusted proxy hop count. Default outbound concurrency is 8 (configurable 1–64); waiting calls are bounded. Start with workers paused. Keep historical encryption keys available for rekeying and retained backups.

```sh
npm run build
npm run migrate
npm run admin:bootstrap
npm start
```

For bootstrap only, provide `ADMIN_EMAIL` and `ADMIN_PASSWORD` (minimum 10 characters, maximum 72 UTF-8 bytes). Bootstrap refuses existing accounts; remove those credentials afterward. Serve the built frontend and API through the same HTTPS origin. Follow the backup, populated migration, ingress credential, reconnect and provider canary gates in [OPERATIONS.md](docs/OPERATIONS.md) before enabling workers.

Salla native webhook signatures and manual relay tokens are separate ingress contracts. Manual senders must use `X-F5R-Webhook-Token`; Telegram requires its configured secret header. Configure external services only in the intended environment. Starting the API with a Telegram token may configure its webhook.

## Verification

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run test:load
npm audit
```

Tests isolate SQLite and mock provider mutations. The load command creates an in-memory 10,000-order fixture and checks authenticated tenant pagination and readiness latency. It does not establish production capacity. Production-shaped restore and integration contract checks remain deployment gates.
