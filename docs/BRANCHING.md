# Branching: feature → develop → main

GitHub repo: **[sadaf-jamal-au27/apex-bank-app](https://github.com/sadaf-jamal-au27/apex-bank-app)**

```text
feature/<name>  ──PR──►  develop  ──PR──►  main
                     │                 │
                     └─ CI: typecheck, build, docker images
```

| Branch | Role |
|--------|------|
| **`feature/<name>`** | Short-lived. **PR into `develop` only.** |
| **`develop`** | Integration. App CI on every PR. |
| **`main`** | Release. Only **`develop` → `main`** PRs. |

Do **not** push directly to `develop` or `main`.

Protect both branches on GitHub (PR required; required check: **Typecheck & build**).
