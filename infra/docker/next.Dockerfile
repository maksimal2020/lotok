# syntax=docker/dockerfile:1.7
# Общий образ для Next.js-приложений: --build-arg APP=web | admin
FROM node:22-bookworm-slim AS build
ARG APP=web
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/${APP}/package.json apps/${APP}/
RUN pnpm install --frozen-lockfile --filter @lotok/${APP}...
COPY packages/shared packages/shared
COPY apps/${APP} apps/${APP}
# Адрес API внутри кластера используется для rewrites (dev) и SSR-запросов.
ARG API_INTERNAL_URL=http://api:4000
ARG NEXT_PUBLIC_SITE_URL=https://lotok.example
ARG NEXT_PUBLIC_ADMIN_URL=https://admin.lotok.example
ENV API_INTERNAL_URL=${API_INTERNAL_URL} NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL} NEXT_PUBLIC_ADMIN_URL=${NEXT_PUBLIC_ADMIN_URL} NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @lotok/shared build && pnpm --filter @lotok/${APP} build

FROM node:22-bookworm-slim AS runtime
ARG APP=web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
RUN groupadd -r app && useradd -r -g app app
COPY --from=build /repo/apps/${APP}/.next/standalone ./
COPY --from=build /repo/apps/${APP}/.next/static ./apps/${APP}/.next/static
COPY --from=build /repo/apps/${APP}/public ./apps/${APP}/public
ENV APP_DIR=apps/${APP}
USER app
EXPOSE 3000
HEALTHCHECK --interval=20s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "node ${APP_DIR}/server.js"]
