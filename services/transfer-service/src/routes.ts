import type { FastifyInstance, ServiceDeps } from "@banking/service-core";

const LEDGER_URL = process.env.LEDGER_URL ?? "http://127.0.0.1:4104";
const ACCOUNT_URL = process.env.ACCOUNT_URL ?? "http://127.0.0.1:4103";

export function registerRoutes(app: FastifyInstance, deps: ServiceDeps): void {
  app.post("/v1/transfers", async (req, reply) => {
    if (!deps.db) return reply.code(503).send({ error: "database_unavailable" });
    const body = req.body as {
      userId?: string;
      fromAccountId?: string;
      toAccountId?: string;
      toAccountNumber?: string;
      amountPaise?: number;
      idempotencyKey?: string;
      narration?: string;
    };

    const from = body.fromAccountId ?? "";
    const amount = Number(body.amountPaise ?? 0);
    const key = body.idempotencyKey?.trim() ?? "";
    if (!body.userId || !from || amount <= 0 || !key) {
      return reply.code(400).send({ error: "invalid_transfer" });
    }

    // Ownership check on source account
    const ownRes = await fetch(`${ACCOUNT_URL}/v1/accounts/${from}?userId=${body.userId}`);
    if (!ownRes.ok) return reply.code(403).send({ error: "from_account_forbidden" });

    let to = body.toAccountId ?? "";
    if (!to && body.toAccountNumber) {
      const { rows } = await deps.db.query<{ id: string }>(
        `SELECT id FROM account.accounts WHERE account_number=$1 AND status='open'`,
        [body.toAccountNumber]
      );
      to = rows[0]?.id ?? "";
    }
    if (!to || from === to) return reply.code(400).send({ error: "invalid_destination" });

    const existing = await deps.db.query(
      `SELECT id, status, journal_id FROM transfer.transfers WHERE idempotency_key=$1`,
      [key]
    );
    if (existing.rows[0]) {
      return {
        id: existing.rows[0].id,
        status: existing.rows[0].status,
        journalId: existing.rows[0].journal_id,
        deduped: true,
      };
    }

    const transferId = crypto.randomUUID();
    await deps.db.query(
      `INSERT INTO transfer.transfers
         (id, from_account_id, to_account_id, amount_paise, status, idempotency_key)
       VALUES ($1,$2,$3,$4,'pending',$5)`,
      [transferId, from, to, amount, key]
    );

    const journalRes = await fetch(`${LEDGER_URL}/v1/journals`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        idempotencyKey: `xfer:${key}`,
        referenceType: "transfer",
        referenceId: transferId,
        narration: body.narration ?? "IMPS / internal transfer",
        legs: [
          { accountId: from, direction: "debit", amountPaise: amount },
          { accountId: to, direction: "credit", amountPaise: amount },
        ],
      }),
    });

    const journalBody = (await journalRes.json()) as { journalId?: string; error?: string };
    if (!journalRes.ok) {
      await deps.db.query(`UPDATE transfer.transfers SET status='failed' WHERE id=$1`, [transferId]);
      await deps.db.query(
        `INSERT INTO audit.events (actor_user_id, action, resource_type, resource_id, meta)
         VALUES ($1,'transfer.failed','transfer',$2,$3::jsonb)`,
        [body.userId, transferId, JSON.stringify({ error: journalBody.error })]
      );
      return reply.code(journalRes.status).send({ error: journalBody.error ?? "ledger_failed" });
    }

    await deps.db.query(
      `UPDATE transfer.transfers SET status='posted', journal_id=$1 WHERE id=$2`,
      [journalBody.journalId, transferId]
    );
    await deps.db.query(
      `INSERT INTO audit.events (actor_user_id, action, resource_type, resource_id, meta)
       VALUES ($1,'transfer.posted','transfer',$2,$3::jsonb)`,
      [body.userId, transferId, JSON.stringify({ amountPaise: amount, journalId: journalBody.journalId })]
    );
    await deps.publish("transfer.posted", { transferId, amountPaise: amount, userId: body.userId });
    return reply.code(201).send({
      id: transferId,
      status: "posted",
      journalId: journalBody.journalId,
      amountPaise: amount,
    });
  });

  app.get("/v1/transfers/:id", async (req, reply) => {
    if (!deps.db) return reply.code(503).send({ error: "database_unavailable" });
    const { id } = req.params as { id: string };
    const { rows } = await deps.db.query(`SELECT * FROM transfer.transfers WHERE id=$1`, [id]);
    if (!rows[0]) return reply.code(404).send({ error: "not_found" });
    const r = rows[0];
    return {
      id: r.id,
      fromAccountId: r.from_account_id,
      toAccountId: r.to_account_id,
      amountPaise: Number(r.amount_paise),
      status: r.status,
      journalId: r.journal_id,
    };
  });
}
