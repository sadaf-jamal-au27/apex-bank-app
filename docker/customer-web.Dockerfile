# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/customer-web ./apps/customer-web
RUN corepack enable \
  && pnpm install --frozen-lockfile \
  && pnpm --filter @banking/customer-web build

FROM nginx:1.27-alpine
COPY docker/customer-web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/customer-web/dist /usr/share/nginx/html
EXPOSE 80
