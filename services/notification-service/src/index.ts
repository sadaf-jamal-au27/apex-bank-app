import { createService } from "@banking/service-core";

const service = createService({
  name: "notification-service",
  domain: "notify",
  port: 4109,
  pubsubEvents: [],
  enableDatabase: false,
});

service.app.get("/v1/info", async () => ({ service: "notification-service", domain: "notify", status: "scaffold" }));
await service.start();
