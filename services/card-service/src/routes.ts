import { randomBytes } from "node:crypto";
import type { FastifyInstance, ServiceDeps } from "@banking/service-core";

export function registerRoutes(app: FastifyInstance, deps: ServiceDeps): void {
  app.get("/v1/cards", async (req, reply) => {
    if (!deps.db) return reply.code(503).send({ error: "database_unavailable" });
    const userId = (req.query as { userId?: string }).userId;
    if (!userId) return reply.code(400).send({ error: "userId_required" });
    const { rows } = await deps.db.query(
      `SELECT cd.id, cd.last4, cd.network, cd.status, cd.account_id, cd.created_at,
              a.account_number
       FROM card.cards cd
       JOIN customer.profiles c ON c.id = cd.customer_id
       JOIN account.accounts a ON a.id = cd.account_id
       WHERE c.user_id = $1
       ORDER BY cd.created_at DESC`,
      [userId]
    );
    return {
      items: rows.map((r) => ({
        id: r.id,
        last4: r.last4,
        network: r.network,
        status: r.status,
        accountId: r.account_id,
        accountNumber: r.account_number,
        maskedPan: `XXXX-XXXX-XXXX-${r.last4}`,
        createdAt: r.created_at,
      })),
    };
  });

  app.post("/v1/cards", async (req, reply) => {
    if (!deps.db) return reply.code(503).send({ error: "database_unavailable" });
    const body = req.body as { userId?: string; accountId?: string; network?: string };
    if (!body.userId || !body.accountId) {
      return reply.code(400).send({ error: "invalid_input" });
    }

    const own = await deps.db.query<{ customer_id: string }>(
      `SELECT a.customer_id FROM account.accounts a
       JOIN customer.profiles c ON c.id = a.customer_id
       WHERE a.id=$1 AND c.user_id=$2 AND a.status='open'`,
      [body.accountId, body.userId]
    );
    if (!own.rows[0]) return reply.code(403).send({ error: "account_forbidden" });

    const existing = await deps.db.query(
      `SELECT id FROM card.cards WHERE account_id=$1 AND status='active'`,
      [body.accountId]
    );
    if (existing.rows[0]) return reply.code(409).send({ error: "card_already_active" });

    const last4 = String(Math.floor(1000 + Math.random() * 9000));
    const tokenRef = `tok_${randomBytes(16).toString("hex")}`; // vault token — not PAN
    const id = crypto.randomUUID();
    const network = body.network ?? "Rupay";

    await deps.db.query(
      `INSERT INTO card.cards (id, account_id, customer_id, last4, network, token_ref)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, body.accountId, own.rows[0].customer_id, last4, network, tokenRef]
    );
    await deps.publish("card.issued", { cardId: id, last4, accountId: body.accountId });
    return reply.code(201).send({
      id,
      last4,
      network,
      status: "active",
      maskedPan: `XXXX-XXXX-XXXX-${last4}`,
      accountId: body.accountId,
    });
  });

  app.post("/v1/cards/:id/block", async (req, reply) => {
    if (!deps.db) return reply.code(503).send({ error: "database_unavailable" });
    const { id } = req.params as { id: string };
    const body = req.body as { userId?: string };
    if (!body.userId) return reply.code(400).send({ error: "userId_required" });

    const { rows } = await deps.db.query(
      `UPDATE card.cards cd
       SET status='blocked'
       FROM customer.profiles c
       WHERE cd.id=$1 AND cd.customer_id=c.id AND c.user_id=$2 AND cd.status='active'
       RETURNING cd.id, cd.last4, cd.status`,
      [id, body.userId]
    );
    if (!rows[0]) return reply.code(404).send({ error: "not_found" });
    await deps.publish("card.blocked", { cardId: id });
    return { id: rows[0].id, last4: rows[0].last4, status: rows[0].status };
  });
}
