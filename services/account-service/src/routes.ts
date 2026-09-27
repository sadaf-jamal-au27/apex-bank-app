import type { FastifyInstance, ServiceDeps } from "@banking/service-core";

const LEDGER_URL = process.env.LEDGER_URL ?? "http://127.0.0.1:4104";

function accountNumber(): string {
  const n = Date.now().toString().slice(-10);
  const c = Math.floor(Math.random() * 90 + 10);
  return `5011${n}${c}`; // looks like a real savings a/c number
}

async function postDeposit(accountId: string, amountPaise: number, key: string, narration: string) {
  const res = await fetch(`${LEDGER_URL}/v1/deposits`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accountId, amountPaise, idempotencyKey: key, narration }),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

export function registerRoutes(app: FastifyInstance, deps: ServiceDeps): void {
  app.get("/v1/customers/by-user/:userId", async (req, reply) => {
    if (!deps.db) return reply.code(503).send({ error: "database_unavailable" });
    const { userId } = req.params as { userId: string };
    const { rows } = await deps.db.query(
      `SELECT id, user_id, kyc_status, date_of_birth, address_line, city, state, pincode, created_at
       FROM customer.profiles WHERE user_id=$1`,
      [userId]
    );
    if (!rows[0]) return reply.code(404).send({ error: "not_found" });
    const r = rows[0];
    return {
      id: r.id,
      userId: r.user_id,
      kycStatus: r.kyc_status,
      dateOfBirth: r.date_of_birth,
      addressLine: r.address_line,
      city: r.city,
      state: r.state,
      pincode: r.pincode,
      createdAt: r.created_at,
    };
  });

  app.put("/v1/customers/by-user/:userId/kyc", async (req, reply) => {
    if (!deps.db) return reply.code(503).send({ error: "database_unavailable" });
    const { userId } = req.params as { userId: string };
    const body = req.body as {
      dateOfBirth?: string;
      addressLine?: string;
      city?: string;
      state?: string;
      pincode?: string;
    };
    if (!body.addressLine || !body.city || !body.state || !body.pincode || !body.dateOfBirth) {
      return reply.code(400).send({ error: "kyc_fields_required" });
    }

    let customerId: string;
    const existing = await deps.db.query<{ id: string }>(
      `SELECT id FROM customer.profiles WHERE user_id=$1`,
      [userId]
    );
    if (existing.rows[0]) {
      customerId = existing.rows[0].id;
      await deps.db.query(
        `UPDATE customer.profiles
         SET date_of_birth=$2, address_line=$3, city=$4, state=$5, pincode=$6, kyc_status='verified'
         WHERE id=$1`,
        [customerId, body.dateOfBirth, body.addressLine, body.city, body.state, body.pincode]
      );
    } else {
      customerId = crypto.randomUUID();
      await deps.db.query(
        `INSERT INTO customer.profiles
           (id, user_id, kyc_status, date_of_birth, address_line, city, state, pincode)
         VALUES ($1,$2,'verified',$3,$4,$5,$6,$7)`,
        [customerId, userId, body.dateOfBirth, body.addressLine, body.city, body.state, body.pincode]
      );
    }
    await deps.publish("customer.kyc_verified", { customerId, userId });
    return { customerId, kycStatus: "verified" };
  });

  app.post("/v1/accounts", async (req, reply) => {
    if (!deps.db) return reply.code(503).send({ error: "database_unavailable" });
    const body = req.body as {
      userId?: string;
      productCode?: string;
      openingDepositPaise?: number;
    };
    if (!body.userId) return reply.code(400).send({ error: "userId_required" });
    const product = body.productCode ?? "SAV_INR";
    if (!["SAV_INR", "CUR_INR"].includes(product)) {
      return reply.code(400).send({ error: "invalid_product" });
    }

    const { rows: customers } = await deps.db.query<{ id: string; kyc_status: string }>(
      `SELECT id, kyc_status FROM customer.profiles WHERE user_id=$1`,
      [body.userId]
    );
    let customerId = customers[0]?.id;
    if (!customerId) {
      customerId = crypto.randomUUID();
      await deps.db.query(
        `INSERT INTO customer.profiles (id, user_id, kyc_status) VALUES ($1,$2,'pending')`,
        [customerId, body.userId]
      );
    }

    const id = crypto.randomUUID();
    const num = accountNumber();
    // Always open at zero — funding goes through ledger deposit
    await deps.db.query(
      `INSERT INTO account.accounts
         (id, customer_id, product_code, account_number, available_balance_paise)
       VALUES ($1,$2,$3,$4,0)`,
      [id, customerId, product, num]
    );

    const opening = Math.max(0, Number(body.openingDepositPaise ?? 0));
    let journalId: string | undefined;
    if (opening > 0) {
      const dep = await postDeposit(id, opening, `open:${id}`, "Opening deposit");
      if (!dep.ok) {
        return reply.code(dep.status).send({ error: "opening_deposit_failed", detail: dep.body });
      }
      journalId = (dep.body as { journalId?: string }).journalId;
    }

    const { rows: bal } = await deps.db.query<{ available_balance_paise: string }>(
      `SELECT available_balance_paise FROM account.accounts WHERE id=$1`,
      [id]
    );

    await deps.publish("account.opened", { accountId: id, customerId, product, journalId });
    return reply.code(201).send({
      id,
      accountNumber: num,
      productCode: product,
      availableBalancePaise: Number(bal[0]?.available_balance_paise ?? 0),
      currency: "INR",
      openingJournalId: journalId,
    });
  });

  app.post("/v1/accounts/:id/deposit", async (req, reply) => {
    if (!deps.db) return reply.code(503).send({ error: "database_unavailable" });
    const { id } = req.params as { id: string };
    const body = req.body as { userId?: string; amountPaise?: number; idempotencyKey?: string };
    if (!body.userId || !body.amountPaise || !body.idempotencyKey) {
      return reply.code(400).send({ error: "invalid_input" });
    }
    const own = await deps.db.query(
      `SELECT a.id FROM account.accounts a
       JOIN customer.profiles c ON c.id = a.customer_id
       WHERE a.id=$1 AND c.user_id=$2 AND a.status='open'`,
      [id, body.userId]
    );
    if (!own.rows[0]) return reply.code(404).send({ error: "account_not_found" });

    const dep = await postDeposit(
      id,
      Number(body.amountPaise),
      body.idempotencyKey,
      "Customer cash deposit"
    );
    return reply.code(dep.status).send(dep.body);
  });

  app.get("/v1/accounts", async (req, reply) => {
    if (!deps.db) return reply.code(503).send({ error: "database_unavailable" });
    const userId = (req.query as { userId?: string }).userId;
    if (!userId) return reply.code(400).send({ error: "userId_required" });
    const { rows } = await deps.db.query(
      `SELECT a.id, a.account_number, a.product_code, a.status,
              a.available_balance_paise, a.currency, a.created_at
       FROM account.accounts a
       JOIN customer.profiles c ON c.id = a.customer_id
       WHERE c.user_id = $1 AND a.product_code IN ('SAV_INR','CUR_INR')
       ORDER BY a.created_at`,
      [userId]
    );
    return {
      items: rows.map((r) => ({
        id: r.id,
        accountNumber: r.account_number,
        productCode: r.product_code,
        status: r.status,
        availableBalancePaise: Number(r.available_balance_paise),
        currency: r.currency,
        createdAt: r.created_at,
      })),
    };
  });

  app.get("/v1/accounts/:id", async (req, reply) => {
    if (!deps.db) return reply.code(503).send({ error: "database_unavailable" });
    const { id } = req.params as { id: string };
    const userId = (req.query as { userId?: string }).userId;
    const { rows } = await deps.db.query(
      `SELECT a.id, a.account_number, a.product_code, a.status,
              a.available_balance_paise, a.currency, a.customer_id, c.user_id
       FROM account.accounts a
       JOIN customer.profiles c ON c.id = a.customer_id
       WHERE a.id=$1`,
      [id]
    );
    if (!rows[0]) return reply.code(404).send({ error: "not_found" });
    if (userId && rows[0].user_id !== userId) return reply.code(403).send({ error: "forbidden" });
    const r = rows[0];
    return {
      id: r.id,
      accountNumber: r.account_number,
      productCode: r.product_code,
      status: r.status,
      availableBalancePaise: Number(r.available_balance_paise),
      currency: r.currency,
      customerId: r.customer_id,
      userId: r.user_id,
    };
  });

  app.get("/v1/accounts/:id/transactions", async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = new URLSearchParams(req.query as Record<string, string>).toString();
    const res = await fetch(`${LEDGER_URL}/v1/accounts/${id}/transactions?${q}`);
    const body = await res.json().catch(() => ({}));
    return reply.code(res.status).send(body);
  });

  // Beneficiaries
  app.get("/v1/beneficiaries", async (req, reply) => {
    if (!deps.db) return reply.code(503).send({ error: "database_unavailable" });
    const userId = (req.query as { userId?: string }).userId;
    if (!userId) return reply.code(400).send({ error: "userId_required" });
    const { rows } = await deps.db.query(
      `SELECT b.id, b.nickname, b.account_number, b.ifsc, b.account_id, b.created_at
       FROM customer.beneficiaries b
       JOIN customer.profiles c ON c.id = b.customer_id
       WHERE c.user_id = $1
       ORDER BY b.created_at DESC`,
      [userId]
    );
    return {
      items: rows.map((r) => ({
        id: r.id,
        nickname: r.nickname,
        accountNumber: r.account_number,
        ifsc: r.ifsc,
        accountId: r.account_id,
        createdAt: r.created_at,
      })),
    };
  });

  app.post("/v1/beneficiaries", async (req, reply) => {
    if (!deps.db) return reply.code(503).send({ error: "database_unavailable" });
    const body = req.body as {
      userId?: string;
      nickname?: string;
      accountNumber?: string;
      ifsc?: string;
    };
    if (!body.userId || !body.nickname || !body.accountNumber) {
      return reply.code(400).send({ error: "invalid_input" });
    }

    const { rows: customers } = await deps.db.query<{ id: string }>(
      `SELECT id FROM customer.profiles WHERE user_id=$1`,
      [body.userId]
    );
    if (!customers[0]) return reply.code(400).send({ error: "complete_kyc_first" });

    const peer = await deps.db.query<{ id: string }>(
      `SELECT id FROM account.accounts WHERE account_number=$1 AND status='open'`,
      [body.accountNumber]
    );

    const id = crypto.randomUUID();
    try {
      await deps.db.query(
        `INSERT INTO customer.beneficiaries
           (id, customer_id, nickname, account_number, ifsc, account_id)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          id,
          customers[0].id,
          body.nickname.trim(),
          body.accountNumber.trim(),
          body.ifsc ?? "APEX0000001",
          peer.rows[0]?.id ?? null,
        ]
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("unique")) return reply.code(409).send({ error: "beneficiary_exists" });
      throw e;
    }
    return reply.code(201).send({
      id,
      nickname: body.nickname,
      accountNumber: body.accountNumber,
      ifsc: body.ifsc ?? "APEX0000001",
      accountId: peer.rows[0]?.id ?? null,
      internal: Boolean(peer.rows[0]),
    });
  });
}
