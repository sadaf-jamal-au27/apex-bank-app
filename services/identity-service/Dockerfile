# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/service-core ./packages/service-core
COPY services/identity-service ./services/identity-service
RUN corepack enable \
  && pnpm install --frozen-lockfile \
  && pnpm --filter @banking/service-core build \
  && pnpm --filter @banking/identity-service build \
  && printf 'deploy-all-files=true\n' >> .npmrc \
  && pnpm --filter @banking/identity-service deploy --prod /deploy

FROM gcr.io/distroless/nodejs22-debian12:nonroot
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /deploy ./
USER nonroot
EXPOSE 8080
CMD ["dist/index.js"]
