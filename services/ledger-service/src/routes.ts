import type { FastifyInstance, ServiceDeps } from "@banking/service-core";

type LegInput = {
  accountId: string;
  direction: "debit" | "credit";
  amountPaise: number;
};

type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

const HOUSE_FUNDING = "00000000-0000-4000-8000-000000000010";
const HOUSE_MERCHANT = "00000000-0000-4000-8000-000000000020";

async function postJournal(
  client: DbClient,
  opts: {
    key: string;
    referenceType: string;
    referenceId: string;
    narration: string;
    legs: LegInput[];
  }
): Promise<{ journalId: string; amountPaise: number }> {
  const debit = opts.legs
    .filter((l) => l.direction === "debit")
    .reduce((s, l) => s + Number(l.amountPaise), 0);
  const credit = opts.legs
    .filter((l) => l.direction === "credit")
    .reduce((s, l) => s + Number(l.amountPaise), 0);
  if (debit !== credit || debit <= 0) throw new Error("unbalanced_journal");

  const journalId = crypto.randomUUID();
  await client.query(
    `INSERT INTO ledger.journals
       (id, idempotency_key, reference_type, reference_id, narration, created_by_service)
     VALUES ($1,$2,$3,$4,$5,'ledger-service')`,
    [journalId, opts.key, opts.referenceType, opts.referenceId, opts.narration]
  );

  for (const leg of opts.legs) {
    const amount = Number(leg.amountPaise);
    if (amount <= 0) throw new Error("invalid_leg_amount");
    await client.query(
      `INSERT INTO ledger.journal_legs (journal_id, account_id, direction, amount_paise)
       VALUES ($1,$2,$3,$4)`,
      [journalId, leg.accountId, leg.direction, amount]
    );
    const delta = leg.direction === "credit" ? amount : -amount;
    const upd = await client.query(
      `UPDATE account.accounts
       SET available_balance_paise = available_balance_paise + $1
       WHERE id = $2 AND status = 'open'
         AND available_balance_paise + $1 >= 0
       RETURNING id`,
      [delta, leg.accountId]
    );
    if (!upd.rows[0]) throw new Error("insufficient_funds_or_account_closed");
  }

  await client.query(
    `INSERT INTO audit.events (action, resource_type, resource_id, meta)
     VALUES ('ledger.posted','journal',$1,$2::jsonb)`,
    [journalId, JSON.stringify({ legs: opts.legs.length, amountPaise: debit, referenceType: opts.referenceType })]
  );

  return { journalId, amountPaise: debit };
}

export function registerRoutes(app: FastifyInstance, deps: ServiceDeps): void {
  app.post("/v1/journals", async (req, reply) => {
    if (!deps.db) return reply.code(503).send({ error: "database_unavailable" });
    const body = req.body as {
      idempotencyKey?: string;
      referenceType?: string;
      referenceId?: string;
      narration?: string;
      legs?: LegInput[];
    };
    const key = body.idempotencyKey?.trim();
    const legs = body.legs ?? [];
    if (!key || legs.length < 2) {
      return reply.code(400).send({ error: "idempotencyKey_and_two_legs_required" });
    }

    const existing = await deps.db.query(`SELECT id FROM ledger.journals WHERE idempotency_key=$1`, [key]);
    if (existing.rows[0]) return { journalId: existing.rows[0].id, deduped: true };

    const client = await deps.db.connect();
    try {
      await client.query("BEGIN");
      const result = await postJournal(client, {
        key,
        referenceType: body.referenceType ?? "journal",
        referenceId: body.referenceId ?? crypto.randomUUID(),
        narration: body.narration ?? "",
        legs,
      });
      await client.query("COMMIT");
      await deps.publish("ledger.posted", result);
      return reply.code(201).send(result);
    } catch (e: unknown) {
      await client.query("ROLLBACK");
      const msg = e instanceof Error ? e.message : "post_failed";
      if (msg.includes("insufficient")) return reply.code(409).send({ error: msg });
      if (msg.includes("unbalanced")) return reply.code(400).send({ error: msg });
      if (msg.includes("unique") || msg.includes("duplicate")) {
        const again = await deps.db.query(`SELECT id FROM ledger.journals WHERE idempotency_key=$1`, [key]);
        if (again.rows[0]) return { journalId: again.rows[0].id, deduped: true };
      }
      throw e;
    } finally {
      client.release();
    }
  });

  app.post("/v1/deposits", async (req, reply) => {
    if (!deps.db) return reply.code(503).send({ error: "database_unavailable" });
    const body = req.body as {
      accountId?: string;
      amountPaise?: number;
      idempotencyKey?: string;
      narration?: string;
    };
    const accountId = body.accountId ?? "";
    const amount = Number(body.amountPaise ?? 0);
    const key = body.idempotencyKey?.trim() ?? "";
    if (!accountId || amount <= 0 || !key) {
      return reply.code(400).send({ error: "invalid_deposit" });
    }

    const existing = await deps.db.query(`SELECT id FROM ledger.journals WHERE idempotency_key=$1`, [key]);
    if (existing.rows[0]) return { journalId: existing.rows[0].id, deduped: true };

    const client = await deps.db.connect();
    try {
      await client.query("BEGIN");
      const result = await postJournal(client, {
        key,
        referenceType: "deposit",
        referenceId: accountId,
        narration: body.narration ?? "Customer deposit",
        legs: [
          { accountId: HOUSE_FUNDING, direction: "debit", amountPaise: amount },
          { accountId, direction: "credit", amountPaise: amount },
        ],
      });
      await client.query("COMMIT");
      await deps.publish("ledger.posted", result);
      return reply.code(201).send(result);
    } catch (e: unknown) {
      await client.query("ROLLBACK");
      const msg = e instanceof Error ? e.message : "post_failed";
      if (msg.includes("insufficient")) return reply.code(409).send({ error: msg });
      throw e;
    } finally {
      client.release();
    }
  });

  app.get("/v1/accounts/:accountId/balance", async (req, reply) => {
    if (!deps.db) return reply.code(503).send({ error: "database_unavailable" });
    const { accountId } = req.params as { accountId: string };
    const { rows } = await deps.db.query<{ available_balance_paise: string }>(
      `SELECT available_balance_paise FROM account.accounts WHERE id=$1`,
      [accountId]
    );
    if (!rows[0]) return reply.code(404).send({ error: "not_found" });
    return { accountId, availableBalancePaise: Number(rows[0].available_balance_paise) };
  });

  app.get("/v1/accounts/:accountId/transactions", async (req, reply) => {
    if (!deps.db) return reply.code(503).send({ error: "database_unavailable" });
    const { accountId } = req.params as { accountId: string };
    const limit = Math.min(100, Number((req.query as { limit?: string }).limit ?? 50));

    const { rows } = await deps.db.query(
      `SELECT jl.id, jl.direction, jl.amount_paise, jl.currency,
              j.id AS journal_id, j.reference_type, j.reference_id, j.narration, j.posted_at
       FROM ledger.journal_legs jl
       JOIN ledger.journals j ON j.id = jl.journal_id
       WHERE jl.account_id = $1
       ORDER BY j.posted_at DESC, jl.id DESC
       LIMIT $2`,
      [accountId, limit]
    );

    return {
      accountId,
      items: rows.map((r) => ({
        id: String(r.id),
        journalId: r.journal_id,
        direction: r.direction,
        amountPaise: Number(r.amount_paise),
        currency: r.currency,
        referenceType: r.reference_type,
        referenceId: r.reference_id,
        narration: r.narration,
        postedAt: r.posted_at,
        signedPaise: r.direction === "credit" ? Number(r.amount_paise) : -Number(r.amount_paise),
      })),
    };
  });

  app.get("/v1/ledger/meta", async () => ({
    houseFundingAccountId: HOUSE_FUNDING,
    houseMerchantAccountId: HOUSE_MERCHANT,
  }));

  app.get("/v1/ledger/reconcile/:accountId", async (req, reply) => {
    if (!deps.db) return reply.code(503).send({ error: "database_unavailable" });
    const { accountId } = req.params as { accountId: string };
    const { rows } = await deps.db.query<{
      cache_paise: string;
      ledger_paise: string;
    }>(
      `SELECT a.available_balance_paise::text AS cache_paise,
              COALESCE(SUM(CASE WHEN jl.direction = 'credit' THEN jl.amount_paise ELSE -jl.amount_paise END), 0)::text AS ledger_paise
       FROM account.accounts a
       LEFT JOIN ledger.journal_legs jl ON jl.account_id = a.id
       WHERE a.id = $1
       GROUP BY a.available_balance_paise`,
      [accountId]
    );
    if (!rows[0]) return reply.code(404).send({ error: "not_found" });
    const cachePaise = Number(rows[0].cache_paise);
    const ledgerPaise = Number(rows[0].ledger_paise);
    return {
      accountId,
      cachePaise,
      ledgerPaise,
      balanced: cachePaise === ledgerPaise,
    };
  });
}
