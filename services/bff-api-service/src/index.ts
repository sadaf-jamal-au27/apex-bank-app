import { createService } from "@banking/service-core";
import { registerRoutes } from "./routes.js";

const service = createService({
  name: "bff-api-service",
  domain: "edge",
  port: 4090,
  pubsubEvents: [],
  enableDatabase: false,
});

registerRoutes(service.app, service.deps);
await service.start();
