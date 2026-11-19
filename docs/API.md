# API

REST, JSON, версия в URI: `/api/v1/...`. Интерактивная спецификация OpenAPI — `GET /api/docs` (Swagger UI), JSON — `GET /api/docs-json` (включается `SWAGGER_ENABLED`; в production рекомендуется закрыть на ingress). Контракты ответов — `packages/shared/src/types.ts`, входные схемы — `packages/shared/src/schemas` (zod, по ним же генерируются схемы OpenAPI).

## Общие правила
- **Авторизация**: `Authorization: Bearer <access>` (15 мин). Обновление — `POST /auth/refresh`. Веб: refresh в httpOnly cookie `lotok_rt` (`SameSite=Strict`, path `/api/v1/auth`) + заголовок `X-CSRF-Token` = cookie `lotok_csrf`. Мобильные: заголовок `X-Client-Platform: ios|android`, refresh в теле.
- **Ошибки**: `{ statusCode, code, message, details?, requestId }`. Клиенты ориентируются на `code` (`validation_error`, `unauthorized`, `forbidden`, `not_found`, `invalid_transition`, `version_conflict`, `listing_limit_exceeded`, `rate_limited`, `payment_provider_error`, …). `429` содержит `Retry-After`.
- **Пагинация**: `?page=&limit=` → `{ items, total, page, limit }`; курсорная (чаты, уведомления): `?cursor=` → `{ items, nextCursor }`.
- **Идемпотентность**: `Idempotency-Key` для `POST /orders` и `POST /billing/purchases` (повтор возвращает тот же результат 24 ч). Сообщения — `clientMessageId`.
- **Оптимистическая блокировка**: `PATCH /listings/:id` требует `version`; при конфликте — `409 version_conflict`.
- **Деньги** — в копейках (целые числа).
- **Лимиты**: 600 запросов/мин на IP; отдельные лимиты на вход, SMS, загрузки, чат, поиск и т.д.

## Эндпоинты

### Аутентификация `/auth`
| Метод | Путь | Описание |
|---|---|---|
| POST | `/auth/register` | Регистрация (email, password, displayName, acceptTerms, acceptPersonalData) → токены, письмо подтверждения |
| POST | `/auth/login` | Вход по паролю (блокировка после 5 неудач за 15 мин) |
| POST | `/auth/verify-email` | Подтверждение email по токену из письма |
| POST | `/auth/resend-verification` | Повторное письмо |
| POST | `/auth/phone/request` · `/auth/phone/verify` | Вход/регистрация по SMS-коду (5 попыток, 1 SMS/мин, 5/час) |
| POST | `/auth/password/reset-request` · `/auth/password/reset` | Восстановление доступа (ответ не раскрывает наличие аккаунта) |
| POST | `/auth/password/change` | Смена пароля (остальные сессии завершаются) |
| POST | `/auth/refresh` | Ротация refresh-токена (повтор старого → отзыв сессии) |
| POST | `/auth/logout` · `/auth/logout-all` | Выход / выход со всех устройств |
| GET/DELETE | `/auth/sessions[/:id]` | Список и завершение сессий |
| POST | `/auth/phone/attach/request` · `/auth/phone/attach` | Привязка телефона |

### Пользователи и компании
`GET/PATCH/DELETE /users/me` · `GET/PUT /users/me/notification-preferences` · `POST/DELETE /users/me/push-tokens` · `GET /users/me/blocked` · `POST/DELETE /users/:id/block` · `GET /users/:id` (публичный профиль) · `GET /users/:id/reviews` · `POST /organizations` · `GET/PATCH /organizations/:id` · `GET/POST /organizations/:id/members` · `DELETE /organizations/:id/members/:userId`

### Каталог
`GET /categories` (дерево) · `GET /categories/slug/:slug` · `GET /categories/:id/attributes` (схема формы и фильтров) · `GET /regions?parentId=&q=` · `GET /regions/cities?popular=1` · `GET /regions/:id`

### Медиа
`POST /media?purpose=listing|avatar|chat|org_logo` (multipart `file`) → `MediaItem` (`status: pending→ready|failed`) · `GET /media/:id` · `DELETE /media/:id` · `GET /media/private?key&exp&sig` (подписанная ссылка)

### Объявления
| Метод | Путь | Описание |
|---|---|---|
| POST | `/listings` | Черновик |
| GET | `/listings/mine?status=` | Мои объявления + счётчики по статусам |
| GET | `/listings/by-seller/:userId` | Активные объявления продавца |
| GET | `/listings/:id` | Карточка (владелец видит в любом статусе) |
| PATCH | `/listings/:id` | Изменение (`version`); существенные правки активного → повторная модерация |
| POST | `/listings/:id/submit` · `/republish` | На модерацию (квоты, автомодерация) |
| POST | `/listings/:id/unpublish` · `/sold` · `/archive` · DELETE `/listings/:id` | Переходы жизненного цикла |
| POST | `/listings/:id/view` | Учёт просмотра (уникально, 30 мин) |
| GET | `/listings/:id/phone` | Телефон продавца (только авторизованным, лимит) |
| GET | `/listings/:id/stats?extended=1` · `/history` | Статистика (90 дней — с услугой аналитики/PRO), история статусов |

### Поиск и вовлечённость
`GET /search` — параметры: `q, categoryId, cityId, priceMin, priceMax, condition, delivery, withPhoto, sellerId, lat, lng, radiusKm, bbox=s,w,n,e, sort=relevance|date_desc|price_asc|price_desc|distance, page, limit, attr.<key>=v1,v2, attr.<key>.min=, attr.<key>.max=` → `{ items, premium, total, facets, engine }` · `GET /search/suggest?q=` · `GET /search/map` (точки) · `GET/POST/DELETE /favorites[/:listingId]` · `GET /favorites/ids` · `GET/POST/PATCH/DELETE /saved-searches` · `GET /recommendations` · `GET/DELETE /recently-viewed`

### Мессенджер
REST: `POST /conversations` (listingId, message) · `GET /conversations?archived=&q=&cursor=` · `GET /conversations/unread` · `GET /conversations/search?q=` · `GET /conversations/:id` · `GET/POST /conversations/:id/messages` · `POST /conversations/:id/read|delivered|archive|unarchive`

WebSocket (Socket.IO, путь `/socket.io`, `auth: { token }`):
- клиент → сервер (с ack `{ ok, data | code, message }`): `message:send {conversationId, body, attachmentMediaId?, clientMessageId?}`, `conversation:read`, `message:delivered`, `typing`
- сервер → клиент: `ready`, `message:new`, `message:delivered`, `message:read`, `conversation:read`, `typing`, `notification:new`, `order:updated`, `auth:error`

### Заказы, платежи, услуги
`POST /orders` (Idempotency-Key) · `GET /orders?role=buyer|seller` · `GET /orders/:id` · `POST /orders/:id/confirm|ship|deliver|complete|cancel|request_refund|approve_refund` · `GET /orders/delivery/quote?listingId&city` · `GET /payments` · `GET /payments/:id` · `POST /payments/:id/sync` · `GET /payments/ledger` · `POST /payments/webhooks/:provider` · `GET/POST /payments/test/:providerPaymentId[/complete]` (только mock-провайдер) · `GET /billing/services?listingId=` · `POST /billing/purchases` · `GET /billing/purchases[/:id]` · `GET /billing/quotas` · `GET /billing/ads?slot=` · `POST /billing/ads/:id/click`

### Отзывы и жалобы
`POST /reviews` (orderId | listingId, rating, text) · `POST /complaints` (targetType listing|user|message|review) · `GET /complaints/mine`

### Администрирование `/admin` (RBAC, аудит)
`dashboard` · `analytics?days=` · `users[/:id]` · `users/:id/block|unblock|roles|bonus` · `organizations[/:id/verify|status]` · `listings[/:id]` · `moderation/queue` · `listings/:id/moderate|unblock` · `stop-words` · `complaints[/:id][/resolve]` · `reviews/:id/status` · `categories[/:id]` · `categories/:id/attributes[/:attributeId]` · `attributes[/:id]` · `regions[/:id]` · `services[/:id]` · `ads[/:id]` · `payments` · `payments/:id/refund` · `ledger/trial-balance` · `orders[/:id][/:action]` · `audit` · `security-events` · `settings[/:key]` · `search/reindex` · `system`

Права по ролям — `packages/shared/src/permissions.ts`.

### Служебные
`GET /health/live` · `GET /health/ready` (PostgreSQL, Redis, поиск, хранилище) · `GET /metrics` (Prometheus; `METRICS_TOKEN`) · `/api/v1/_test/*` — только при `ENABLE_TEST_ENDPOINTS=true` вне production (E2E).
