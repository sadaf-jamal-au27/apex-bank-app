import { createService } from "@banking/service-core";

const service = createService({
  name: "loan-service",
  domain: "loan",
  port: 4108,
  pubsubEvents: [],
  enableDatabase: true,
});

service.app.get("/v1/info", async () => ({ service: "loan-service", domain: "loan", status: "scaffold" }));
await service.start();
