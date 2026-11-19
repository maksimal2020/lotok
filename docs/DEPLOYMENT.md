# Запуск и развёртывание

## 1. Локальная разработка (без Docker для приложений)
Требуется: Node.js 22, pnpm 10, PostgreSQL 16, Redis 7. OpenSearch — по желанию (`SEARCH_DRIVER=postgres` по умолчанию).

```bash
pnpm install
pnpm --filter @lotok/shared build
```
```bash
# инфраструктура в Docker (если нет локальных PostgreSQL/Redis)
docker compose up -d postgres redis mailpit
```
```bash
cd apps/api && pnpm build && pnpm db:migrate && SEED_DEMO=1 pnpm db:seed
```
```bash
# API (QUEUE_MODE=inline — без отдельного worker; для полноценной очереди запустите dev:worker)
cd apps/api && QUEUE_MODE=inline pnpm start
```
```bash
cd apps/web && pnpm dev      # http://localhost:3000 (проксирует /api на :4000)
```
```bash
cd apps/admin && pnpm dev    # http://localhost:3001
```
```bash
cd apps/mobile && pnpm start # Expo Dev Server; API по умолчанию http://localhost:4000 (Android-эмулятор → 10.0.2.2)
```
Учётные записи seed: `admin@lotok.local`, `moderator@`, `support@`, `finance@` — пароль `Admin12345` (только для разработки; в production задайте `SEED_ADMIN_PASSWORD` или создайте сотрудников через `PUT /admin/users/:id/roles`). Демо: `seller@lotok.local` / `buyer@lotok.local`, пароль `Demo12345`.

Swagger: http://localhost:4000/api/docs. Письма: Mailpit http://localhost:8025 (при `MAIL_DRIVER=smtp`) или в логе API (`MAIL_DRIVER=log`).

## 2. Полный стек в Docker Compose
```bash
cp .env.example .env   # при необходимости поправьте значения
docker compose up -d --build
```
- Сайт: http://localhost:8080, админка: http://localhost:8081, MinIO: http://localhost:9001, Mailpit: http://localhost:8025.
- Сервис `migrate` применяет миграции и seed до старта `api`/`worker`.
- Мониторинг: `docker compose --profile monitoring up -d` (Prometheus :9090, Grafana :3030, Loki + Promtail).
- Антивирус: `docker compose --profile antivirus up -d` и `AV_DRIVER=clamav`.
- Проверено в среде разработки: сборка образов API и web (Dockerfile из `infra/docker`), запуск контейнера API (readiness: PostgreSQL, Redis, OpenSearch, хранилище — ok), отдача страниц контейнером web. Полный `docker compose up` целиком в среде разработки не запускался (ограничения Docker Hub по скачиванию образов).

## 3. Production (Kubernetes + Helm)
Чарт `infra/helm/lotok`: Deployments api / worker / web / admin, HPA, PDB, Ingress (публичный и админский с IP-allowlist), Job миграций (pre-upgrade hook), CronJob резервного копирования, ClamAV.

1. Подготовить управляемые сервисы (в РФ — для локализации ПДн): PostgreSQL 16 (с PITR), Redis 7, OpenSearch 2.x (≥ 3 узла, реплики), S3 (публичный бакет за CDN + приватный), SMTP, SMS-шлюз, ЮKassa (магазин), Expo/EAS.
2. Создать Secret `lotok-secrets` из secret storage (Vault/Lockbox/External Secrets): `DATABASE_URL, REDIS_URL, JWT_ACCESS_SECRET, APP_SIGNING_SECRET, S3_ACCESS_KEY, S3_SECRET_KEY, YOOKASSA_SHOP_ID, YOOKASSA_SECRET_KEY, SMSRU_API_ID, EXPO_ACCESS_TOKEN, METRICS_TOKEN, SMTP_URL, OPENSEARCH_PASSWORD`. Секреты в Git не хранятся.
3. Файл значений окружения (домены, S3, OpenSearch) — переменная CI `HELM_VALUES_FILE`.
4. Деплой — GitLab CI (`.gitlab-ci.yml`): staging автоматически из ветки по умолчанию, production — вручную по тегу:
```bash
helm upgrade --install lotok infra/helm/lotok -n lotok --create-namespace -f values.production.yaml --set image.tag=<sha> --wait --atomic
```
5. После первого деплоя: `POST /admin/search/reindex` (или задание `search.reindex-stale` проиндексирует объявления в течение 10 минут).

Конфигурация валидируется при старте (`apps/api/src/config/config.ts`): production не запустится с dev-секретами, `QUEUE_MODE=inline`, `ENABLE_TEST_ENDPOINTS`, без `COOKIE_SECURE`, а ЮKassa — без реквизитов.

### Масштабирование
- API — HPA по CPU (2–10 реплик), WebSocket масштабируется через Redis adapter. Worker — реплики по нагрузке очередей (`GET /admin/system`).
- PostgreSQL — пул `DATABASE_POOL_MAX` на реплику (20); при росте — PgBouncer и реплики чтения.
- OpenSearch — `number_of_replicas` > 0 для production (задаётся при создании индекса; см. `opensearch.engine.ts`).

## 4. Резервное копирование и восстановление
- Ежедневный `pg_dump` — CronJob `lotok-db-backup` / `infra/backup/backup.sh` (проверка читаемости дампа, sha256, выгрузка в S3, ротация).
- Point-in-time recovery — средствами управляемой PostgreSQL (WAL-архив).
- Восстановление: `TARGET_DATABASE_URL=… infra/backup/restore.sh lotok-<дата>.dump` (по умолчанию отказывается перезаписать рабочую БД).
- Индекс OpenSearch восстанавливается переиндексацией из PostgreSQL; Redis — кэш и очереди (AOF), не источник истины.

## 5. Внешние интеграции — что нужно для production

| Интеграция | Статус | Что нужно |
|---|---|---|
| ЮKassa | Адаптер написан (создание, статус, возвраты, webhook по IP, чеки), **не проверен на реальном магазине** | `YOOKASSA_SHOP_ID`, `YOOKASSA_SECRET_KEY`, URL webhook `https://<домен>/api/v1/payments/webhooks/yookassa`; для оплаты товаров продавцов — договор «Безопасная сделка»/сплитование (выплаты продавцам не реализованы) |
| SMS.ru | Адаптер (HTTP API), не проверен с ключом | `SMSRU_API_ID`, отправитель |
| SMTP | Работает (проверено с Mailpit) | реквизиты почтового сервиса, SPF/DKIM/DMARC |
| Expo Push | Адаптер, не проверен | EAS projectId, `EXPO_ACCESS_TOKEN`, ключи APNs/FCM в EAS |
| Доставка (СДЭК, Boxberry, Почта) | Только тестовый провайдер | договоры и адаптеры под интерфейс `DeliveryProvider` |
| ОРД (маркировка рекламы) | erid вводится вручную | договор с ОРД, интеграция API отчётности |
| ClamAV | Протокол INSTREAM реализован, в среде разработки не запускался | контейнер clamav, `AV_DRIVER=clamav` |
| Тайлы карт | OSM по умолчанию | коммерческий провайдер тайлов (`NEXT_PUBLIC_MAP_TILES`), условия использования |
| VK ID / Яндекс ID / ЕСИА | Модель данных `external_identities` | регистрация приложений, реализация OAuth-потоков |
| Мобильные сборки | `eas.json`, экспорт бандлов проверен | Apple Developer, Google Play, EAS-аккаунт |
