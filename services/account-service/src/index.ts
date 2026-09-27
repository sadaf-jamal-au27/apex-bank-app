import { createService } from "@banking/service-core";
import { registerRoutes } from "./routes.js";

const service = createService({
  name: "account-service",
  domain: "account",
  port: 4103,
  pubsubEvents: ["account.opened"],
  enableDatabase: true,
});

registerRoutes(service.app, service.deps);
await service.start();
