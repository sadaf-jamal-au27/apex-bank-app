import { createService } from "@banking/service-core";
import { registerRoutes } from "./routes.js";

const service = createService({
  name: "transfer-service",
  domain: "transfer",
  port: 4105,
  pubsubEvents: ["transfer.posted"],
  enableDatabase: true,
});

registerRoutes(service.app, service.deps);
await service.start();
