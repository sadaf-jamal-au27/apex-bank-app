# GitHub (apex-bank-app)

This repository **is** the Apex Bank application: https://github.com/sadaf-jamal-au27/apex-bank-app

| Item | Status |
|------|--------|
| Default branch | `main` |
| Integration branch | `develop` (create if missing) |
| Workflow | `.github/workflows/ci.yml` — typecheck, build, docker (no GAR push until WIF) |
| Infra / WIF | Landing zone is **not** this repo. Until split, Terraform lives under `gke-microservices` → `banking-infra/gke-banking-infra`. WIF must list **`apex-bank-app`**. |

Protect `develop` and `main`: PR required, required check **Typecheck & build**.
