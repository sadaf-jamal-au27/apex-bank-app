#!/usr/bin/env node
/**
 * Start Phase-1 banking core locally (identity, account, ledger, transfer, bff).
 * Usage: node scripts/dev-core.mjs
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const filters = [
  "@banking/identity-service",
  "@banking/account-service",
  "@banking/ledger-service",
  "@banking/transfer-service",
  "@banking/payment-service",
  "@banking/card-service",
  "@banking/bff-api-service",
];

for (const filter of filters) {
  const child = spawn("pnpm", ["--filter", filter, "dev"], {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      ALLOW_INSECURE_DB_DEFAULTS: process.env.ALLOW_INSECURE_DB_DEFAULTS ?? "true",
      DB_PASSWORD: process.env.DB_PASSWORD ?? "banking",
    },
  });
  child.on("exit", (code) => {
    if (code && code !== 0) console.error(`${filter} exited ${code}`);
  });
}

console.log("Core services starting on 4101/4103/4104/4105 + BFF 4090");
console.log("UI: pnpm --filter @banking/customer-web dev  → http://127.0.0.1:5173");
