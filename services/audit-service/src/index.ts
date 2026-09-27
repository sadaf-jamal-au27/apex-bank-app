import { createService } from "@banking/service-core";

const service = createService({
  name: "audit-service",
  domain: "audit",
  port: 4110,
  pubsubEvents: [],
  enableDatabase: true,
});

service.app.get("/v1/info", async () => ({ service: "audit-service", domain: "audit", status: "scaffold" }));
await service.start();
