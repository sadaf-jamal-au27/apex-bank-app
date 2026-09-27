import { createService } from "@banking/service-core";
import { registerRoutes } from "./routes.js";

const service = createService({
  name: "payment-service",
  domain: "payment",
  port: 4106,
  pubsubEvents: ["payment.posted"],
  enableDatabase: true,
});

registerRoutes(service.app, service.deps);
await service.start();
