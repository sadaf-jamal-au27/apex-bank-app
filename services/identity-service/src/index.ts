import { createService } from "@banking/service-core";
import { registerRoutes } from "./routes.js";

const service = createService({
  name: "identity-service",
  domain: "identity",
  port: 4101,
  pubsubEvents: ["user.registered", "user.login", "user.logout"],
  enableDatabase: true,
});

registerRoutes(service.app, service.deps);
await service.start();
