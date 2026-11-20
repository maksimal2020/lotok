# Запуск и развёртывание

## 1. Локальная разработка (без Docker для приложений)
Требуется: Node.js 22, pnpm 10, PostgreSQL 16, Redis 7. OpenSearch — по желанию (`SEARCH_DRIVER=postgres` по умолчанию).

```bash
pnpm install
pnpm --filter @lotok/shared build
```
```bash
# инфраструктура в Docker (если нет локальных PostgreSQL/Redis)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis mailpit
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
Требуется Docker Engine 24+ с Compose v2 и ~6 ГБ свободной памяти (OpenSearch — 1 ГБ). Файл `.env` не обязателен: значения по умолчанию рассчитаны на локальный запуск.

```bash
git clone https://github.com/maksimal2020/lotok.git && cd lotok
```
```bash
docker compose up -d --build
```
Первый запуск собирает образы `lotok/api`, `lotok/web`, `lotok/admin` (5–10 минут) и наполняет базу справочниками и 39 демо-объявлениями (`SEED_DEMO=1`, отключается `SEED_DEMO=0`).

| Адрес | Что |
|---|---|
| http://localhost:8080 | Сайт (web + API `/api/v1` + WebSocket + фото `/media` через nginx) |
| http://localhost:8081 | Административная панель |
| http://localhost:8025 | Mailpit — все письма (подтверждение email, уведомления) |
| http://localhost:3030 | Grafana (профиль `monitoring`, логин `admin` / `admin`) |
| http://localhost:9090 | Prometheus (профиль `monitoring`) |

Учётные записи: `admin@lotok.local`, `moderator@`, `support@`, `finance@` — `Admin12345`; `seller@lotok.local` / `buyer@lotok.local` — `Demo12345`.

Состав: PostgreSQL 16, Redis 7, OpenSearch 2.17, SeaweedFS (S3-совместимое хранилище; MinIO больше не публикует образы на Docker Hub), Mailpit, `migrate` (миграции + seed, завершается до старта API), `api`, `worker` (BullMQ: обработка фото, индексация, уведомления, расписания), `web`, `admin`, nginx. Бакеты создаются API автоматически; публичный бакет `lotok-media` доступен только на чтение (`infra/seaweedfs/s3.json`), приватный — только через API по подписанной ссылке.

```bash
docker compose ps                                   # состояние сервисов
docker compose logs -f api worker                   # логи
docker compose --profile monitoring up -d           # + Prometheus, Grafana, Loki, Promtail
docker compose --profile antivirus up -d            # + ClamAV (и AV_DRIVER=clamav в .env)
docker compose exec postgres psql -U lotok          # консоль БД
docker compose down                                 # остановить (данные сохраняются в volumes)
docker compose down -v                              # остановить и удалить все данные
```
После изменения кода: `docker compose up -d --build`. Пересоздать поисковый индекс: админка → «Настройки» → «Переиндексировать».

**Проверено в среде разработки** (2026-11-19): `docker compose up` с чистыми volumes — все сервисы healthy; сценарий в браузере через nginx: вход продавца и покупателя, загрузка фото (обработка sharp → SeaweedFS), публикация, поиск через OpenSearch (индексация worker-ом), чат в реальном времени через WebSocket, заказ с тестовой оплатой, вход в админку и сверка счетов; профиль `monitoring` — Prometheus собирает метрики API, Grafana с дашбордом, Loki получает логи. Профиль `antivirus` не запускался.

Если OpenSearch не стартует из-за `vm.max_map_count` (Linux): `sudo sysctl -w vm.max_map_count=262144`. Если на диске хоста занято более ~90%, OpenSearch блокирует запись (в логах API — `index_create_block_exception` / `flood_stage`): освободите место (`docker system prune`) или для локального стенда отключите порог: `docker compose exec opensearch curl -XPUT localhost:9200/_cluster/settings -H 'Content-Type: application/json' -d '{"persistent":{"cluster.routing.allocation.disk.threshold_enabled":false,"cluster.blocks.create_index":null}}'`. Без OpenSearch можно работать на поиске PostgreSQL: `SEARCH_DRIVER=postgres docker compose up -d`.

## 3. Production (Kubernetes + Helm)
Production разворачивается из ветки `main` (порядок веток и выката — [BRANCHING.md](BRANCHING.md)). Чарт `infra/helm/lotok`: Deployments api / worker / web / admin, HPA, PDB, Ingress (публичный и админский с IP-allowlist), Job миграций (pre-upgrade hook), CronJob резервного копирования, ClamAV. Значения окружения — `infra/helm/lotok/values-production.yaml`.

### Чек-лист первого деплоя
1. **Регион размещения.** Для пользователей из РФ база с персональными данными должна находиться в РФ (152-ФЗ, ч. 5 ст. 18; см. [LEGAL.md](LEGAL.md) §1). Кластер и управляемые сервисы за пределами РФ допустимы только после заключения юриста о схеме обработки ПДн.
2. **Управляемые сервисы:** Kubernetes с ingress-nginx и cert-manager (или аналогом), PostgreSQL 16 (с PITR), Redis 7, OpenSearch 2.x (≥ 3 узла, реплики) — или `SEARCH_DRIVER=postgres` на старте, S3 (публичный бакет за CDN + приватный + бакет бэкапов), SMTP, SMS-шлюз, ЮKassa, Expo/EAS.
3. **Secret `lotok-secrets`** в namespace `lotok` — из secret storage (Vault / External Secrets / Sealed Secrets): `SEED_ADMIN_PASSWORD` (≥ 12 символов, нужен при первой установке), `DATABASE_URL, REDIS_URL, JWT_ACCESS_SECRET, APP_SIGNING_SECRET, S3_ACCESS_KEY, S3_SECRET_KEY, YOOKASSA_SHOP_ID, YOOKASSA_SECRET_KEY, SMSRU_API_ID, EXPO_ACCESS_TOKEN, METRICS_TOKEN, SMTP_URL, OPENSEARCH_PASSWORD`. Секреты в Git не хранятся.
4. **Secret `ghcr-pull`** — доступ кластера к приватным образам в ghcr.io (команда — в [BRANCHING.md](BRANCHING.md)).
5. **`values-production.yaml`** — заменить домены `lotok.example`, адреса S3/CDN/OpenSearch, подсети доступа к админке.
6. **GitHub:** environment `production` с ревьюерами и секретом `KUBE_CONFIG`, переменные `SITE_URL`, `ADMIN_SITE_URL`, затем `K8S_DEPLOY_ENABLED=true`.
7. Первая установка (`helm install`) сама загружает справочники (категории, регионы, тарифы, стоп-слова) и создаёт сотрудников `admin@`, `moderator@`, `support@`, `finance@lotok.local` с паролем `SEED_ADMIN_PASSWORD` (`seed.onInstall` в values.yaml; без пароля seed в production не запустится). Демо-объявления в production не создаются. Сразу после установки — сменить пароли сотрудников и завести реальных; затем `POST /admin/search/reindex` (или задание `search.reindex-stale` проиндексирует объявления в течение 10 минут).

### Как происходит выкат
Push/merge в `main` → GitHub Actions: типы, unit, integration (PostgreSQL и OpenSearch), E2E → сборка образов `ghcr.io/<owner>/lotok/{api,web,admin}:<sha>` → ожидание подтверждения в environment `production` → 
```bash
helm upgrade --install lotok infra/helm/lotok -n lotok --create-namespace -f infra/helm/lotok/values-production.yaml --set image.tag=<sha> --wait --atomic
```
Миграции выполняет Job до выката новых подов; при ошибке `--atomic` откатывает релиз. Ручной откат: `helm rollback lotok <ревизия> -n lotok` (миграции БД не откатываются — они пишутся обратно совместимыми).

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
