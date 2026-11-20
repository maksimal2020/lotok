# CLAUDE.md — правила проекта «Лоток»

Платформа частных объявлений (рынок РФ, русский язык, задел на мультистрановость). Модульный монолит + отдельные клиенты.

## Перед началом работы
1. Прочитай `docs/PROGRESS.md` (фактическое состояние), `docs/ROADMAP.md`, `docs/DECISIONS.md`.
2. Проверь реализацию, а не только отметки в документах: `git log`, тесты, код.
3. Подними окружение (см. `docs/DEPLOYMENT.md` → «Локальная разработка»): PostgreSQL 16, Redis 7.
4. После завершения этапа — обнови `docs/PROGRESS.md` и при необходимости остальные документы.

## Ветки и выкат (см. `docs/BRANCHING.md`)
- Работа всегда начинается в ветке `test` и пушится туда для проверки в Docker Compose.
- Продвижение только вперёд и только после подтверждения пользователя: `test → dev` (проверка в compose), `dev → main` (production, Kubernetes). Слияние `--ff-only`, без правок при переносе.
- Код и конфигурация во всех ветках одинаковые; различия окружений — только в `values-*.yaml`, `.env` и секретах. Не заводить «compose-версию» и «k8s-версию» кода.
- Не пушить напрямую в `main`/`dev` без явного разрешения.

## Структура
- `packages/shared` — общие типы ответов API, zod-схемы входных данных, enum'ы, RBAC-матрица, машины состояний (объявление, заказ), API-клиент, дизайн-токены. **Источник истины для контрактов.** После изменений: `pnpm --filter @lotok/shared build`.
- `apps/api` — NestJS 11 (REST `/api/v1`, Socket.IO, BullMQ-worker). Drizzle ORM, миграции в `apps/api/drizzle`.
- `apps/web` — Next.js 15 (App Router, SSR для SEO), Tailwind 4.
- `apps/admin` — отдельный Next.js — административная панель.
- `apps/mobile` — Expo / React Native (iOS + Android).
- `e2e` — Playwright E2E (desktop + mobile viewport).
- `infra` — Docker, Compose, nginx, Helm (`infra/helm/lotok`, `values-production.yaml`), Prometheus/Grafana/Loki, бэкапы.
- `.github/workflows/ci.yml` — CI/CD (GitHub Actions).

## Архитектурные ограничения (не нарушать)
- Права доступа проверяются **на backend** (`JwtAuthGuard` глобально, `@RequirePermissions`, проверки владельца в сервисах). Чужой объект = 404 (защита от IDOR).
- Смена статуса объявления — только через `ListingsService.transition()`, заказа — `OrdersService.transition()`; допустимые переходы — в `packages/shared/src/lifecycle.ts`.
- Деньги — целые копейки (`bigint` в БД, `number` в API). Каждое движение денег/бонусов — проводка в `LedgerService.post()` (двойная запись, идемпотентный ключ). Не смешивать счета `seller_payable`, `platform_revenue`, `user_bonus`.
- Платёжные операции идемпотентны (Idempotency-Key, уникальные `idempotency_key`, `payment_events.provider_event_id`); статус платежа берётся у провайдера, а не из тела webhook.
- Не хранить данные банковских карт. Не называть оплату «безопасной сделкой» — провайдер с удержанием средств не подключён.
- Mock-платежи/доставка — только в тестовом режиме, явно помечены `testMode` в API и UI.
- Входные данные валидируются zod-схемами (`ZBody`/`ZQuery`), SQL — только через Drizzle/параметры (`sql\`...${value}\``), никаких `sql.raw` с пользовательскими данными.
- Загрузки: определение типа по сигнатуре, перекодирование изображений (удаление EXIF), приватные вложения — по подписанным ссылкам.
- Административные действия пишутся в `audit_logs` через `AuditService`.
- Секреты — только через переменные окружения/secret storage; production-конфиг валидируется (`config.ts` отклоняет dev-секреты).
- Демо-данные — только в seed (`SEED_DEMO=1`) и тестах.
- Не выдавать детерминированные рекомендации за ML.

## Команды
```bash
pnpm install
pnpm --filter @lotok/shared build
pnpm --filter @lotok/api build && pnpm --filter @lotok/api db:migrate && SEED_DEMO=1 pnpm --filter @lotok/api db:seed
pnpm --filter @lotok/api test          # unit + integration (нужны PostgreSQL и Redis)
pnpm --filter @lotok/e2e test          # E2E (нужны сборки api/web/admin)
```
Новые миграции: изменить `apps/api/src/database/schema.ts` → `cd apps/api && npx drizzle-kit generate --name=<имя>` → проверить SQL (drizzle не пересоздаёт индексы при пересоздании колонок).

## Стиль
- TypeScript strict, без `any` в бизнес-логике. Сообщения пользователю — на русском, коды ошибок — машинные (`code`).
- Комментарии объясняют «почему». Не оставлять критичные TODO без записи в `docs/PROGRESS.md` → «Известные ограничения».
- Не утверждать, что что-то проверено, если тесты не запускались.
