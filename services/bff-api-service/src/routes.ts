import type { FastifyInstance, FastifyRequest, ServiceDeps } from "@banking/service-core";

const u = (key: string, fallback: string) => process.env[key] ?? fallback;

const URLS = {
  identity: u("IDENTITY_URL", "http://127.0.0.1:4101"),
  account: u("ACCOUNT_URL", "http://127.0.0.1:4103"),
  transfer: u("TRANSFER_URL", "http://127.0.0.1:4105"),
  payment: u("PAYMENT_URL", "http://127.0.0.1:4106"),
  card: u("CARD_URL", "http://127.0.0.1:4107"),
};

type AuthedUser = { id: string; email: string; fullName: string };

async function proxy(url: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function requireUser(req: FastifyRequest): Promise<AuthedUser | null> {
  const auth = String(req.headers.authorization ?? "");
  if (!auth.startsWith("Bearer ")) return null;
  const { status, body } = await proxy(`${URLS.identity}/v1/auth/me`, {
    headers: { authorization: auth },
  });
  if (status !== 200) return null;
  const b = body as { id?: string; email?: string; fullName?: string; user?: AuthedUser };
  if (b.user) return b.user;
  if (b.id && b.email && b.fullName) return { id: b.id, email: b.email, fullName: b.fullName };
  return null;
}

export function registerRoutes(app: FastifyInstance, _deps: ServiceDeps): void {
  app.get("/v1/bff/info", async () => ({
    service: "bff-api-service",
    upstreams: Object.keys(URLS),
  }));

  // --- Auth (public) ---
  app.post("/v1/banking/auth/register", async (req, reply) => {
    const { status, body } = await proxy(`${URLS.identity}/v1/auth/register`, {
      method: "POST",
      body: JSON.stringify(req.body ?? {}),
    });
    return reply.code(status).send(body);
  });

  app.post("/v1/banking/auth/login", async (req, reply) => {
    const { status, body } = await proxy(`${URLS.identity}/v1/auth/login`, {
      method: "POST",
      body: JSON.stringify(req.body ?? {}),
    });
    return reply.code(status).send(body);
  });

  app.get("/v1/banking/auth/me", async (req, reply) => {
    const user = await requireUser(req);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    return { user };
  });

  app.post("/v1/banking/auth/logout", async (req, reply) => {
    const { status, body } = await proxy(`${URLS.identity}/v1/auth/logout`, {
      method: "POST",
      headers: { authorization: String(req.headers.authorization ?? "") },
    });
    return reply.code(status).send(body);
  });

  // --- Protected banking ---
  app.get("/v1/banking/profile", async (req, reply) => {
    const user = await requireUser(req);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const { status, body } = await proxy(`${URLS.account}/v1/customers/by-user/${user.id}`);
    if (status === 404) return { user, profile: null };
    return reply.code(status).send({ user, profile: body });
  });

  app.put("/v1/banking/profile/kyc", async (req, reply) => {
    const user = await requireUser(req);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const { status, body } = await proxy(`${URLS.account}/v1/customers/by-user/${user.id}/kyc`, {
      method: "PUT",
      body: JSON.stringify(req.body ?? {}),
    });
    return reply.code(status).send(body);
  });

  app.get("/v1/banking/accounts", async (req, reply) => {
    const user = await requireUser(req);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const { status, body } = await proxy(
      `${URLS.account}/v1/accounts?userId=${encodeURIComponent(user.id)}`
    );
    return reply.code(status).send(body);
  });

  app.post("/v1/banking/accounts", async (req, reply) => {
    const user = await requireUser(req);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const incoming = (req.body ?? {}) as Record<string, unknown>;
    const { status, body } = await proxy(`${URLS.account}/v1/accounts`, {
      method: "POST",
      body: JSON.stringify({ ...incoming, userId: user.id }),
    });
    return reply.code(status).send(body);
  });

  app.post("/v1/banking/accounts/:id/deposit", async (req, reply) => {
    const user = await requireUser(req);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const { id } = req.params as { id: string };
    const incoming = (req.body ?? {}) as Record<string, unknown>;
    const { status, body } = await proxy(`${URLS.account}/v1/accounts/${id}/deposit`, {
      method: "POST",
      body: JSON.stringify({ ...incoming, userId: user.id }),
    });
    return reply.code(status).send(body);
  });

  app.get("/v1/banking/accounts/:id/transactions", async (req, reply) => {
    const user = await requireUser(req);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const { id } = req.params as { id: string };
    // ownership check
    const own = await proxy(
      `${URLS.account}/v1/accounts/${id}?userId=${encodeURIComponent(user.id)}`
    );
    if (own.status !== 200) return reply.code(own.status).send(own.body);
    const q = new URLSearchParams(req.query as Record<string, string>).toString();
    const { status, body } = await proxy(`${URLS.account}/v1/accounts/${id}/transactions?${q}`);
    return reply.code(status).send(body);
  });

  app.get("/v1/banking/beneficiaries", async (req, reply) => {
    const user = await requireUser(req);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const { status, body } = await proxy(
      `${URLS.account}/v1/beneficiaries?userId=${encodeURIComponent(user.id)}`
    );
    return reply.code(status).send(body);
  });

  app.post("/v1/banking/beneficiaries", async (req, reply) => {
    const user = await requireUser(req);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const incoming = (req.body ?? {}) as Record<string, unknown>;
    const { status, body } = await proxy(`${URLS.account}/v1/beneficiaries`, {
      method: "POST",
      body: JSON.stringify({ ...incoming, userId: user.id }),
    });
    return reply.code(status).send(body);
  });

  app.post("/v1/banking/transfers", async (req, reply) => {
    const user = await requireUser(req);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const incoming = (req.body ?? {}) as Record<string, unknown>;
    const { status, body } = await proxy(`${URLS.transfer}/v1/transfers`, {
      method: "POST",
      body: JSON.stringify({ ...incoming, userId: user.id }),
    });
    return reply.code(status).send(body);
  });

  app.get("/v1/banking/billers", async (req, reply) => {
    const user = await requireUser(req);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const { status, body } = await proxy(`${URLS.payment}/v1/billers`);
    return reply.code(status).send(body);
  });

  app.get("/v1/banking/bill-payments", async (req, reply) => {
    const user = await requireUser(req);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const { status, body } = await proxy(
      `${URLS.payment}/v1/bill-payments?userId=${encodeURIComponent(user.id)}`
    );
    return reply.code(status).send(body);
  });

  app.post("/v1/banking/bill-payments", async (req, reply) => {
    const user = await requireUser(req);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const incoming = (req.body ?? {}) as Record<string, unknown>;
    const { status, body } = await proxy(`${URLS.payment}/v1/bill-payments`, {
      method: "POST",
      body: JSON.stringify({ ...incoming, userId: user.id }),
    });
    return reply.code(status).send(body);
  });

  app.get("/v1/banking/cards", async (req, reply) => {
    const user = await requireUser(req);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const { status, body } = await proxy(
      `${URLS.card}/v1/cards?userId=${encodeURIComponent(user.id)}`
    );
    return reply.code(status).send(body);
  });

  app.post("/v1/banking/cards", async (req, reply) => {
    const user = await requireUser(req);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const incoming = (req.body ?? {}) as Record<string, unknown>;
    const { status, body } = await proxy(`${URLS.card}/v1/cards`, {
      method: "POST",
      body: JSON.stringify({ ...incoming, userId: user.id }),
    });
    return reply.code(status).send(body);
  });

  app.post("/v1/banking/cards/:id/block", async (req, reply) => {
    const user = await requireUser(req);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const { id } = req.params as { id: string };
    const { status, body } = await proxy(`${URLS.card}/v1/cards/${id}/block`, {
      method: "POST",
      body: JSON.stringify({ userId: user.id }),
    });
    return reply.code(status).send(body);
  });
}
