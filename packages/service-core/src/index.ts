import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { PubSub } from "@google-cloud/pubsub";
import pg from "pg";
import pino from "pino";

export type ServiceDeps = {
  db: pg.Pool | null;
  publish: (event: string, payload: unknown) => Promise<void>;
  log: pino.Logger;
};

export type CreateServiceOptions = {
  name: string;
  domain: string;
  port: number;
  pubsubEvents: string[];
  enableDatabase?: boolean;
};

export type BankingService = {
  app: FastifyInstance;
  deps: ServiceDeps;
  start: () => Promise<void>;
};

export function internalHeaders(extra?: HeadersInit): Record<string, string> {
  const token = process.env.SERVICE_MESH_TOKEN ?? "";
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers["x-internal-token"] = token;
  if (extra) {
    const h = new Headers(extra);
    h.forEach((v, k) => {
      headers[k] = v;
    });
  }
  return headers;
}

export function createService(opts: CreateServiceOptions): BankingService {
  const requireDbPassword = opts.enableDatabase && process.env.ALLOW_INSECURE_DB_DEFAULTS !== "true";
  if (requireDbPassword && !process.env.DB_PASSWORD) {
    throw new Error("DB_PASSWORD is required (set ALLOW_INSECURE_DB_DEFAULTS=true only for local demo)");
  }

  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      redact: [
        "req.headers.authorization",
        "req.headers.x-internal-token",
        "password",
        "accessToken",
        "pan",
        "cvv",
        "pin",
        "totp",
      ],
    },
    trustProxy: true,
    requestIdHeader: "x-request-id",
    genReqId: () => crypto.randomUUID(),
  });

  const pubsub =
    process.env.PUBSUB_EMULATOR_HOST || process.env.GOOGLE_CLOUD_PROJECT
      ? new PubSub({ projectId: process.env.GOOGLE_CLOUD_PROJECT })
      : null;

  const topicPrefix = process.env.PUBSUB_TOPIC_PREFIX ?? "banking";

  let pool: pg.Pool | null = null;
  if (opts.enableDatabase) {
    pool = new pg.Pool({
      host: process.env.DB_HOST ?? "127.0.0.1",
      port: Number(process.env.DB_PORT ?? "5434"),
      user: process.env.DB_USER ?? "banking_app",
      password: process.env.DB_PASSWORD ?? "banking",
      database: process.env.DB_NAME ?? "banking",
      max: Number(process.env.DB_POOL_MAX ?? "5"),
      ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: true } : undefined,
    });
  }

  async function publish(event: string, payload: unknown): Promise<void> {
    if (!pubsub) {
      app.log.debug({ event }, "pubsub.skipped.local");
      return;
    }
    const topicName = `${topicPrefix}.${event.replace(/\./g, "-")}`;
    const dataBuffer = Buffer.from(
      JSON.stringify({ event, payload, source: opts.name, ts: new Date().toISOString() })
    );
    await pubsub.topic(topicName).publishMessage({ data: dataBuffer });
  }

  const deps: ServiceDeps = { db: pool, publish, log: app.log as pino.Logger };

  app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "same-site" },
  });
  app.register(cors, {
    origin: (process.env.CORS_ORIGINS ?? "http://localhost:5173").split(","),
    credentials: true,
  });
  app.register(rateLimit, {
    max: Number(process.env.RATE_LIMIT_MAX ?? "200"),
    timeWindow: "1 minute",
  });

  const meshToken = process.env.SERVICE_MESH_TOKEN ?? "";
  const requireInternal = process.env.REQUIRE_INTERNAL_AUTH === "true";

  app.addHook("onRequest", async (req, reply) => {
    reply.header("x-service-name", opts.name);
    reply.header("x-service-domain", opts.domain);
    const path = req.url.split("?")[0] ?? "";
    if (path.startsWith("/health/")) return;
    if (opts.name === "bff-api-service") return;
    if (opts.name === "identity-service" && path.startsWith("/v1/auth/")) return;
    if (!requireInternal) return;
    if (!meshToken || req.headers["x-internal-token"] !== meshToken) {
      return reply.code(401).send({ error: "internal_auth_required" });
    }
  });

  app.get("/health/live", async () => ({ status: "live" }));
  app.get("/health/ready", async () => {
    if (pool) await pool.query("SELECT 1");
    return { status: "ready", service: opts.name, domain: opts.domain };
  });

  async function start(): Promise<void> {
    const listenPort = Number(process.env.PORT ?? opts.port);
    await app.listen({ port: listenPort, host: "0.0.0.0" });
    app.log.info({ port: listenPort, name: opts.name }, "service.started");
  }

  app.addHook("onClose", async () => {
    await pool?.end();
  });

  return { app, deps, start };
}

export type { FastifyInstance, FastifyRequest };
