# GitHub Environment `dev`

| Secret | Source |
|--------|--------|
| `GCP_WIF_PROVIDER` | infra `01-iam`: `terraform output -raw wif_provider` |
| `GCP_CI_SERVICE_ACCOUNT` | `github-ci-banking-dev@ai-rag-agent-project.iam.gserviceaccount.com` |
| `GCP_PROJECT_ID` | `ai-rag-agent-project` (optional) |

Push to **`develop`** or **Run workflow** runs the publish job (GAR `banking/*`).
