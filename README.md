# Лоток — платформа частных объявлений

Товары, недвижимость, транспорт, работа и услуги: веб-сайт (SSR), административная панель, мобильные приложения iOS/Android и единый backend API.

| Компонент | Технологии |
|---|---|
| `apps/api` | NestJS 11, TypeScript, PostgreSQL 16 (Drizzle), Redis, BullMQ, Socket.IO, OpenSearch, S3, OpenAPI |
| `apps/web` | Next.js 15 (App Router, SSR/SEO), React 19, Tailwind CSS 4, TanStack Query |
| `apps/admin` | Next.js 15 — отдельная административная панель (RBAC) |
| `apps/mobile` | Expo SDK 54 / React Native 0.81, expo-router |
| `packages/shared` | Общие контракты API, zod-схемы, машины состояний, RBAC, API-клиент, дизайн-токены |
| `e2e` | Playwright (desktop + mobile) |
| `infra` | Docker, Compose, nginx, Helm, Prometheus, Grafana, Loki, резервное копирование |

## Запуск всего проекта в Docker
```bash
docker compose up -d --build
```
Сайт — http://localhost:8080, админка — http://localhost:8081, почта — http://localhost:8025. Подробности и учётные записи — [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#2-полный-стек-в-docker-compose).

## Локальная разработка
```bash
pnpm install && pnpm --filter @lotok/shared build
```
```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis mailpit
```
```bash
cd apps/api && pnpm build && pnpm db:migrate && SEED_DEMO=1 pnpm db:seed && QUEUE_MODE=inline pnpm start
```
```bash
cd apps/web && pnpm dev
```
Подробно — [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Документация
- [CLAUDE.md](CLAUDE.md) — правила проекта
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/DATABASE.md](docs/DATABASE.md) · [docs/API.md](docs/API.md)
- [docs/SECURITY.md](docs/SECURITY.md) · [docs/LEGAL.md](docs/LEGAL.md)
- [docs/TESTING.md](docs/TESTING.md) · [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
- [docs/ROADMAP.md](docs/ROADMAP.md) · [docs/PROGRESS.md](docs/PROGRESS.md) · [docs/DECISIONS.md](docs/DECISIONS.md)

> Платежи и доставка работают в **тестовом режиме** (mock-провайдеры). Реальные списания не производятся. Подключение ЮKassa и служб доставки — см. DEPLOYMENT.md, раздел 5.
