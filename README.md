# GKE Banking Application

End-to-end **digital banking** platform.

GitHub: **[sadaf-jamal-au27/apex-bank-app](https://github.com/sadaf-jamal-au27/apex-bank-app)**  
Branching: `docs/BRANCHING.md` (`feature` → `develop` → `main`)  
Infra (until its own repo): `sadaf-jamal-au27/gke-microservices` → `banking-infra/gke-banking-infra`

## Why this shape

| Concern | Practical secure choice |
|---------|-------------------------|
| Money truth | **Ledger service** — double-entry journals; balances are derived |
| Amounts | **BIGINT paise** (never float) |
| Auth | Identity service — scrypt passwords, hashed session tokens |
| DB | One Cloud SQL Postgres (dev); **schemas** per domain (`identity`, `customer`, `ledger`, …) |
| Events | Pub/Sub for notifications/audit (local = log skip) |
| Edge | BFF aggregates; UI never talks to money services directly |

## Services (Phase 1)

| Service | Port | Domain | DB |
|---------|------|--------|-----|
| identity-service | 4101 | identity | yes |
| customer-service | 4102 | customer | yes |
| account-service | 4103 | account | yes |
| ledger-service | 4104 | ledger | yes |
| transfer-service | 4105 | transfer | yes |
| payment-service | 4106 | payment | yes |
| card-service | 4107 | card | yes |
| loan-service | 4108 | loan | yes |
| notification-service | 4109 | notify | no |
| audit-service | 4110 | audit | yes |
| bff-api-service | 4090 | edge | no |

## What is real (not dummy)

- Opening deposit / cash-in → **ledger journal** (debit funding pool, credit customer)
- Transfers & bill pay → balanced journals + audit events
- Statements from **immutable journal legs**
- Session required on BFF for money APIs
- Cards store **last4 + token_ref only** (no PAN/CVV)
- Beneficiaries, KYC profile, RuPay debit issue/block

## Local quick start

```bash
cd gke-banking-application
pnpm install
docker compose up -d postgres
# wait ~3s
export PGPASSWORD=banking
psql -h 127.0.0.1 -p 5434 -U banking_app -d banking -f db/migrations/001_identity.sql
psql -h 127.0.0.1 -p 5434 -U banking_app -d banking -f db/migrations/002_customer_account.sql
psql -h 127.0.0.1 -p 5434 -U banking_app -d banking -f db/migrations/003_ledger.sql
psql -h 127.0.0.1 -p 5434 -U banking_app -d banking -f db/migrations/004_banking_ops.sql
psql -h 127.0.0.1 -p 5434 -U banking_app -d banking -f db/migrations/005_audit_controls.sql
pnpm --filter @banking/service-core build
pnpm dev:core          # identity + account + ledger + transfer + bff
pnpm dev:web           # Apex Bank UI → http://127.0.0.1:5173
```

Postgres host port is **5434** (avoids clash with other local stacks on 5433).

Verified smoke path: register → login → open 2 accounts → transfer → balances update via ledger journal.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
# apex-bank-app
