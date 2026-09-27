import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, ServiceDeps, FastifyRequest } from "@banking/service-core";

const SESSION_DAYS = 7;

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const next = scryptSync(password, salt, 64);
  const prev = Buffer.from(hash, "hex");
  if (prev.length !== next.length) return false;
  return timingSafeEqual(prev, next);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function bearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return null;
  return h.slice(7).trim() || null;
}

export function registerRoutes(app: FastifyInstance, deps: ServiceDeps): void {
  app.post("/v1/auth/register", async (req, reply) => {
    if (!deps.db) return reply.code(503).send({ error: "database_unavailable" });
    const body = req.body as { email?: string; password?: string; fullName?: string; phone?: string };
    const email = body.email?.trim().toLowerCase() ?? "";
    const password = body.password ?? "";
    const fullName = body.fullName?.trim() ?? "";
    if (!email.includes("@") || password.length < 8 || fullName.length < 2) {
      return reply.code(400).send({ error: "invalid_input" });
    }
    const id = crypto.randomUUID();
    try {
      await deps.db.query(
        `INSERT INTO identity.users (id, email, full_name, phone, password_hash)
         VALUES ($1,$2,$3,$4,$5)`,
        [id, email, fullName, body.phone ?? null, hashPassword(password)]
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("unique")) return reply.code(409).send({ error: "email_taken" });
      throw e;
    }
    await deps.publish("user.registered", { userId: id, email });
    return reply.code(201).send({ id, email, fullName });
  });

  app.post("/v1/auth/login", async (req, reply) => {
    if (!deps.db) return reply.code(503).send({ error: "database_unavailable" });
    const body = req.body as { email?: string; password?: string };
    const email = body.email?.trim().toLowerCase() ?? "";
    const { rows } = await deps.db.query<{
      id: string;
      email: string;
      full_name: string;
      password_hash: string;
      status: string;
    }>(`SELECT id, email, full_name, password_hash, status FROM identity.users WHERE email=$1`, [email]);
    const user = rows[0];
    if (!user || user.status !== "active" || !verifyPassword(body.password ?? "", user.password_hash)) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }
    const token = randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
    await deps.db.query(
      `INSERT INTO identity.sessions (user_id, token_hash, expires_at) VALUES ($1,$2,$3)`,
      [user.id, hashToken(token), expires.toISOString()]
    );
    await deps.publish("user.login", { userId: user.id });
    return {
      accessToken: token,
      expiresAt: expires.toISOString(),
      user: { id: user.id, email: user.email, fullName: user.full_name },
    };
  });

  app.get("/v1/auth/me", async (req, reply) => {
    if (!deps.db) return reply.code(503).send({ error: "database_unavailable" });
    const token = bearer(req);
    if (!token) return reply.code(401).send({ error: "unauthorized" });
    const { rows } = await deps.db.query<{
      id: string;
      email: string;
      full_name: string;
    }>(
      `SELECT u.id, u.email, u.full_name
       FROM identity.sessions s
       JOIN identity.users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > NOW() AND u.status = 'active'`,
      [hashToken(token)]
    );
    if (!rows[0]) return reply.code(401).send({ error: "unauthorized" });
    return { id: rows[0].id, email: rows[0].email, fullName: rows[0].full_name };
  });

  app.post("/v1/auth/logout", async (req, reply) => {
    if (!deps.db) return reply.code(503).send({ error: "database_unavailable" });
    const token = bearer(req);
    if (token) {
      await deps.db.query(`DELETE FROM identity.sessions WHERE token_hash=$1`, [hashToken(token)]);
    }
    return { ok: true };
  });
}
