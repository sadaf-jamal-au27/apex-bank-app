import { createService } from "@banking/service-core";
import { registerRoutes } from "./routes.js";

const service = createService({
  name: "card-service",
  domain: "card",
  port: 4107,
  pubsubEvents: ["card.issued", "card.blocked"],
  enableDatabase: true,
});

registerRoutes(service.app, service.deps);
await service.start();
