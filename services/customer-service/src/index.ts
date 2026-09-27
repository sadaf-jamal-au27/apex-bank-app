import { createService } from "@banking/service-core";

const service = createService({
  name: "customer-service",
  domain: "customer",
  port: 4102,
  pubsubEvents: [],
  enableDatabase: true,
});

service.app.get("/v1/info", async () => ({ service: "customer-service", domain: "customer", status: "scaffold" }));
await service.start();
