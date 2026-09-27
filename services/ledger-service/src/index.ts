import { createService } from "@banking/service-core";
import { registerRoutes } from "./routes.js";

const service = createService({
  name: "ledger-service",
  domain: "ledger",
  port: 4104,
  pubsubEvents: ["ledger.posted"],
  enableDatabase: true,
});

registerRoutes(service.app, service.deps);
await service.start();
