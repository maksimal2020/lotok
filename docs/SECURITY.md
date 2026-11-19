# Безопасность

| Угроза / требование | Мера | Где |
|---|---|---|
| Разграничение доступа (RBAC) | Глобальный `JwtAuthGuard` (всё закрыто по умолчанию, `@Public()` явно), `PermissionsGuard` + `@RequirePermissions`, матрица ролей в shared | `common/guards.ts`, `packages/shared/src/permissions.ts` |
| IDOR | Проверки владельца/участника в сервисах; чужой объект → 404 | `ListingsService.getOwned`, `ChatService.assertParticipant`, `OrdersService.get`, `MediaService.get` |
| SQL injection | Drizzle + параметризованный `sql\`\``; `sql.raw` с пользовательскими данными запрещён | весь backend |
| XSS | React экранирует вывод; описания — `whitespace-pre-line`, без `dangerouslySetInnerHTML` (кроме JSON-LD с экранированием `<`); CSP у API; файлы — `nosniff`, `Content-Security-Policy: default-src 'none'`; SVG не принимается | web, `bootstrap.ts`, nginx |
| CSRF | Bearer для API; refresh-cookie `SameSite=Strict` + double-submit `X-CSRF-Token` | `auth.controller.ts` |
| Перебор паролей | 5 неудач на аккаунт / 30 на IP за 15 мин → 429; одинаковое время ответа при отсутствии пользователя | `AuthService.login` |
| SMS-бомбинг | 1/мин и 5/час на номер, 20/час на IP; 5 попыток ввода кода | `AuthService.requestPhoneCode` |
| Rate limiting | Redis fixed-window: 600/мин на IP + именованные лимиты; nginx `limit_req` | `RateLimitGuard`, nginx.conf |
| Кража refresh-токена | Ротация, обнаружение повторного использования → отзыв сессии, событие безопасности | `AuthService.refresh` |
| Мгновенный отзыв доступа | `tokenVersion` + кэш состояния; отзыв sid в Redis | `AuthStateService` |
| Пароли | argon2id (m=19 MiB, t=2) | `AuthService` |
| Загрузки | Тип по сигнатуре (белый список), лимиты размера, ClamAV (INSTREAM), перекодирование изображений (EXIF/GPS удаляются, полиглоты обезвреживаются), лимит 50 Мп (decompression bomb), OOXML без макросов, приватные вложения по подписи | `file-security.ts`, `media.service.ts` |
| Валидация | zod на всех входах; длины, форматы (телефон E.164, ИНН с контрольной суммой) | `packages/shared/src/schemas` |
| Секреты | Только env/secret storage; production-конфиг отклоняет dev-значения, inline-очередь и тестовые эндпоинты | `config.ts`, Helm `existingSecret` |
| Платежи | Подпись webhook (HMAC) / IP + повторный запрос статуса; дедупликация событий; сверка суммы; идемпотентность | `payments.service.ts` |
| Спам и злоупотребления | Автомодерация (стоп-слова, контакты/ссылки, дубли, новые аккаунты), лимиты сообщений, порог жалоб → повторная модерация, блокировка пользователей | `auto-moderation.service.ts`, `community.service.ts` |
| Журналирование | `security_events` (входы, блокировки, reuse, загрузки, webhook), `audit_logs` (все действия админов с IP и before/after), pino JSON-логи с request-id, редактирование заголовков Authorization/Cookie | `platform.services.ts`, `app.module.ts` |
| Админ-панель | Отдельный хост, IP-allowlist, noindex; роли проверяются на backend | Helm ingress, nginx |
| Заголовки | helmet, HSTS (ingress), X-Frame-Options DENY, Referrer-Policy, Permissions-Policy | `bootstrap.ts`, `next.config.mjs` |

## Не реализовано / рекомендовано до запуска
- 2FA для сотрудников (TOTP/WebAuthn) — обязательна для админ-ролей.
- WAF/anti-bot (капча при подозрительной активности регистрации и SMS).
- Penetration test, SAST/DAST в CI (semgrep, OWASP ZAP), dependency scanning (`pnpm audit`, Renovate).
- Шифрование чувствительных полей на уровне приложения (телефоны) — сейчас защита на уровне БД/диска провайдера.
- Ротация `JWT_ACCESS_SECRET` с поддержкой нескольких ключей (kid).
