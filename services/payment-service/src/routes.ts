import type { FastifyInstance, ServiceDeps } from "@banking/service-core";

const LEDGER_URL = process.env.LEDGER_URL ?? "http://127.0.0.1:4104";
const HOUSE_MERCHANT = "00000000-0000-4000-8000-000000000020";

export function registerRoutes(app: FastifyInstance, deps: ServiceDeps): void {
  app.get("/v1/billers", async (_req, reply) => {
    if (!deps.db) return reply.code(503).send({ error: "database_unavailable" });
    const { rows } = await deps.db.query(`SELECT code, name, category FROM payment.billers ORDER BY name`);
    return { items: rows };
  });

  app.post("/v1/bill-payments", async (req, reply) => {
    if (!deps.db) return reply.code(503).send({ error: "database_unavailable" });
    const body = req.body as {
      userId?: string;
      fromAccountId?: string;
      billerCode?: string;
      consumerRef?: string;
      amountPaise?: number;
      idempotencyKey?: string;
    };
    const amount = Number(body.amountPaise ?? 0);
    const key = body.idempotencyKey?.trim() ?? "";
    if (!body.userId || !body.fromAccountId || !body.billerCode || !body.consumerRef || amount <= 0 || !key) {
      return reply.code(400).send({ error: "invalid_input" });
    }

    const own = await deps.db.query(
      `SELECT a.id, c.id AS customer_id FROM account.accounts a
       JOIN customer.profiles c ON c.id = a.customer_id
       WHERE a.id=$1 AND c.user_id=$2 AND a.status='open'`,
      [body.fromAccountId, body.userId]
    );
    if (!own.rows[0]) return reply.code(403).send({ error: "account_forbidden" });

    const biller = await deps.db.query<{ code: string; name: string }>(
      `SELECT code, name FROM payment.billers WHERE code=$1`,
      [body.billerCode]
    );
    if (!biller.rows[0]) return reply.code(400).send({ error: "unknown_biller" });

    const existing = await deps.db.query(
      `SELECT id, status, journal_id FROM payment.bill_payments WHERE idempotency_key=$1`,
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

    const paymentId = crypto.randomUUID();
    await deps.db.query(
      `INSERT INTO payment.bill_payments
         (id, customer_id, from_account_id, biller_code, biller_name, consumer_ref, amount_paise, status, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8)`,
      [
        paymentId,
        own.rows[0].customer_id,
        body.fromAccountId,
        biller.rows[0].code,
        biller.rows[0].name,
        body.consumerRef,
        amount,
        key,
      ]
    );

    const journalRes = await fetch(`${LEDGER_URL}/v1/journals`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        idempotencyKey: `bill:${key}`,
        referenceType: "bill_payment",
        referenceId: paymentId,
        narration: `${biller.rows[0].name} · ${body.consumerRef}`,
        legs: [
          { accountId: body.fromAccountId, direction: "debit", amountPaise: amount },
          { accountId: HOUSE_MERCHANT, direction: "credit", amountPaise: amount },
        ],
      }),
    });
    const journalBody = (await journalRes.json()) as { journalId?: string; error?: string };
    if (!journalRes.ok) {
      await deps.db.query(`UPDATE payment.bill_payments SET status='failed' WHERE id=$1`, [paymentId]);
      return reply.code(journalRes.status).send({ error: journalBody.error ?? "ledger_failed" });
    }

    await deps.db.query(
      `UPDATE payment.bill_payments SET status='posted', journal_id=$1 WHERE id=$2`,
      [journalBody.journalId, paymentId]
    );
    await deps.publish("payment.posted", { paymentId, amountPaise: amount });
    return reply.code(201).send({
      id: paymentId,
      status: "posted",
      journalId: journalBody.journalId,
      billerName: biller.rows[0].name,
      amountPaise: amount,
    });
  });

  app.get("/v1/bill-payments", async (req, reply) => {
    if (!deps.db) return reply.code(503).send({ error: "database_unavailable" });
    const userId = (req.query as { userId?: string }).userId;
    if (!userId) return reply.code(400).send({ error: "userId_required" });
    const { rows } = await deps.db.query(
      `SELECT p.id, p.biller_code, p.biller_name, p.consumer_ref, p.amount_paise, p.status, p.created_at
       FROM payment.bill_payments p
       JOIN customer.profiles c ON c.id = p.customer_id
       WHERE c.user_id = $1
       ORDER BY p.created_at DESC
       LIMIT 50`,
      [userId]
    );
    return {
      items: rows.map((r) => ({
        id: r.id,
        billerCode: r.biller_code,
        billerName: r.biller_name,
        consumerRef: r.consumer_ref,
        amountPaise: Number(r.amount_paise),
        status: r.status,
        createdAt: r.created_at,
      })),
    };
  });
}
