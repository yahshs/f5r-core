# F5R integration core

React application and Express API for seller/admin Salla integrations, product rules, SMM fulfillment, Telegram notifications and purchaser refill requests. SQLite stores tenant data, revocable sessions, durable queues, submission evidence and an immutable financial ledger.

Use Node 24 LTS and `npm ci`. See [SETUP.md](SETUP.md), [the implementation report](docs/SECURITY-IMPLEMENTATION.md) and [OPERATIONS.md](docs/OPERATIONS.md).

```sh
npm ci
npm run dev:full
```

Configure a protected local `.env` first. Production requires independent secrets, HTTPS and an explicit administrator bootstrap. Development demo users require an explicit `DEMO_PASSWORD`; startup never resets existing passwords. Billing, support tickets and outgoing contact/recovery email are unavailable until real services are integrated.

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run test:load
npm audit
```

Provider acceptance and delivery are separate states. Ambiguous paid submissions/refills require provider confirmation in the administrator Operations page; they are never automatically replayed. Provider-reported charges and configured-rate estimates are separate from invoice totals and bank settlement.

SQLite has no database row-level security. This implementation enforces tenant access through authenticated routes, scoped repositories and database ownership constraints. PostgreSQL RLS and real billing/support are separate projects.

For GitHub → Railway deployment, use [RAILWAY-RELEASE.md](docs/RAILWAY-RELEASE.md). It covers the Docker image, persistent volume, protected metrics/alerts, configuration preflight, restored migration drill and live canary checklist.
