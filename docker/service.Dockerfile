# syntax=docker/dockerfile:1
ARG SERVICE_DIR=identity-service
ARG SERVICE_FILTER=@banking/identity-service

FROM node:22-alpine AS build
ARG SERVICE_DIR
ARG SERVICE_FILTER
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/service-core ./packages/service-core
COPY services/${SERVICE_DIR} ./services/${SERVICE_DIR}
RUN corepack enable \
  && pnpm install --frozen-lockfile \
  && pnpm --filter @banking/service-core build \
  && pnpm --filter ${SERVICE_FILTER} build \
  && printf 'deploy-all-files=true\n' >> .npmrc \
  && pnpm --filter ${SERVICE_FILTER} deploy --prod /deploy

FROM gcr.io/distroless/nodejs22-debian12:nonroot
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /deploy ./
USER nonroot
EXPOSE 8080
CMD ["dist/index.js"]
