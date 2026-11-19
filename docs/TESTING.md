# Тестирование

| Уровень | Где | Инструменты | Что проверяет |
|---|---|---|---|
| Unit (shared) | `packages/shared/src/*.test.ts` | Jest | Машины состояний объявления/заказа, RBAC-матрица, деньги, валидация (телефон, пароль, заказ), склонения |
| Unit (api) | `apps/api/src/**/*.spec.ts` | Jest | Сигнатуры файлов (отказ исполняемым/SVG/docm), контрольная сумма ИНН, синонимы поиска, IP-фильтр webhook ЮKassa, конфигурация production |
| Integration + API | `apps/api/test/*.e2e.ts` | Jest + Supertest + socket.io-client, **реальные PostgreSQL и Redis** | Все HTTP-сценарии через полный стек Nest (guards, pipes, фильтры) |
| E2E | `e2e/tests/*.spec.ts` | Playwright (Chromium), production-сборки web/admin + реальный API | Сквозной пользовательский сценарий в браузере, desktop и mobile viewport |
| Мобильное приложение | `apps/mobile` | Jest (jest-expo), `expo export` | Логика клиента, сборка JS-бандлов Android/iOS |

## Покрытие требований ТЗ (п. 16)

| Требование | Тесты |
|---|---|
| Разграничение доступа | `admin.e2e.ts` (RBAC по ролям, назначение ролей, немедленное действие блокировки), `listings.e2e.ts` (IDOR), `search-chat.e2e.ts` (чужие диалоги, WS), `commerce.e2e.ts` (чужие заказы/платежи), E2E «Доступ и безопасность интерфейса» |
| Платёжные сценарии | `commerce.e2e.ts`: оплата → webhook → статус; поддельная подпись → 403; дубликат webhook; подписанный webhook без подтверждения провайдером не меняет статус; отказ от оплаты; отмена оплаченного → автоматический возврат; возврат после доставки; баланс ledger; бонусы не учитываются как выручка; оплата услуг, квоты и возврат слота при отклонении |
| Конкурентные изменения | `listings.e2e.ts` (два PATCH с одной `version` → 200 + 409), `commerce.e2e.ts` (два покупателя последнего товара → 201 + 409 out_of_stock) |
| Загрузки файлов | `listings.e2e.ts`: генерация размеров, отказ по сигнатуре (exe под .jpg, HTML), PDF в объявление, превышение размера, битый JPEG → `failed`, `nosniff`; unit — docm/svg |
| WebSocket | `search-chat.e2e.ts`: доставка в реальном времени, ack, идемпотентность `clientMessageId`, receipt прочтения, отказ без токена, отказ в чужом диалоге; E2E — обновление списка диалогов и статуса заказа без перезагрузки |
| Мобильные устройства | `e2e/tests/mobile.spec.ts` (Pixel 7): навигация, отсутствие горизонтального скролла, фильтры, регистрация; `apps/mobile` — unit-тесты и экспорт бандлов |
| Сквозной сценарий | `e2e/tests/marketplace.spec.ts`: регистрация → подтверждение email → объявление с 2 фото → модерация (ручная категория) → модератор одобряет в админке → поиск другим пользователем → избранное → сообщение (WS) → заказ → тестовая оплата → статусы → отзыв → товар продан |

## Запуск

Требуются PostgreSQL 16 и Redis 7 (локально или `docker compose up -d postgres redis`).

```bash
pnpm install
pnpm --filter @lotok/shared build && pnpm --filter @lotok/shared test
```
```bash
cd apps/api && npx jest --selectProjects unit
```
```bash
# интеграционные: БД lotok_test пересоздаётся автоматически; Redis db 15 очищается
cd apps/api && npx jest --selectProjects integration
```
```bash
# E2E: сначала собрать API, web и admin (порты 4000/3000/3001 должны быть свободны)
pnpm --filter @lotok/api build && pnpm --filter @lotok/web build && pnpm --filter @lotok/admin build
cd e2e && npx playwright test --trace off
```
Переменные: `TEST_DATABASE_URL`, `TEST_REDIS_URL`, `TEST_SEARCH_DRIVER=opensearch` (интеграционные тесты на OpenSearch), `E2E_DATABASE_URL`, `E2E_REDIS_URL`.

## Особенности
- В тестах `QUEUE_MODE=inline`: фоновые задания выполняются в процессе; `jobs.drain()` дожидается их завершения.
- Почта/SMS/push — драйверы `memory`; в E2E письма читаются через `/api/v1/_test/mail` (эндпоинт регистрируется только при `ENABLE_TEST_ENDPOINTS=true` и не в production).
- Лимиты запросов изолируются уникальным `X-Forwarded-For` на тестового клиента.
- Платежи — только mock-провайдер; адаптер ЮKassa покрыт unit-тестами разбора webhook, но **не проверялся против реального API ЮKassa**.

## Не выполнялось (явно)
- Нагрузочное тестирование (план: k6, сценарии поиска/чата/создания объявлений; цели — p95 < 300 мс для поиска при 200 RPS на реплику).
- Тестирование на физических устройствах iOS/Android и сборки нативных бинарников (нужны EAS / Xcode / Android SDK).
- Penetration test и проверка ClamAV в боевом режиме.
