import { Inject, Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import { and, desc, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import type { AuthResponse, ClientPlatform, LoginInput, RegisterInput } from '@lotok/shared';
import { CONFIG, type AppConfig } from '../../config/config';
import { DB, type Db } from '../../database/database.module';
import { authCodes, sessions, users } from '../../database/schema';
import { RateLimitService } from '../../infra/redis.module';
import { MailService, SmsService } from '../../infra/messaging.providers';
import { SecurityEventsService } from '../../infra/platform.services';
import { Errors } from '../../common/errors';
import { addDays, randomDigits, randomToken, sha256 } from '../../common/util';
import type { ClientInfo } from '../../common/auth.decorators';
import { UsersService } from '../users/users.service';
import { AuthStateService } from './auth-state.service';

const ARGON_OPTS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
/** Хэш для выравнивания времени ответа при несуществующем пользователе (защита от перечисления). */
let dummyHash: string | null = null;

export interface IssuedTokens extends AuthResponse {
  refreshToken: string;
  sessionId: string;
}

interface SessionMeta {
  client: ClientInfo;
  platform?: ClientPlatform;
  deviceName?: string;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly users: UsersService,
    private readonly authState: AuthStateService,
    private readonly limiter: RateLimitService,
    private readonly mail: MailService,
    private readonly sms: SmsService,
    private readonly security: SecurityEventsService,
  ) {}

  /* ---------------------------- email / пароль ---------------------------- */

  async register(input: RegisterInput, meta: SessionMeta): Promise<IssuedTokens> {
    const [existing] = await this.db.select({ id: users.id }).from(users).where(eq(users.email, input.email));
    if (existing) throw Errors.conflict('email_taken', 'Пользователь с таким email уже зарегистрирован');
    const passwordHash = await argon2.hash(input.password, ARGON_OPTS);
    const now = new Date();
    const [user] = await this.db
      .insert(users)
      .values({
        email: input.email,
        passwordHash,
        displayName: input.displayName,
        termsAcceptedAt: now,
        personalDataConsentAt: now,
      })
      .returning({ id: users.id });
    await this.sendEmailVerification(user.id, input.email, meta.client);
    await this.security.record('register', { userId: user.id, ip: meta.client.ip, userAgent: meta.client.userAgent });
    return this.issueSession(user.id, meta);
  }

  async login(input: LoginInput, meta: SessionMeta): Promise<IssuedTokens> {
    const ip = meta.client.ip ?? 'unknown';
    // Защита от перебора: лимит неудачных попыток на аккаунт и на IP.
    const accountKey = `login-fail:acc:${input.email}`;
    const ipKey = `login-fail:ip:${ip}`;
    const [accFails, ipFails] = await Promise.all([this.limiter.peek(accountKey), this.limiter.peek(ipKey)]);
    if (accFails >= 5 * this.config.RATE_LIMIT_MULTIPLIER || ipFails >= 30 * this.config.RATE_LIMIT_MULTIPLIER) {
      await this.security.record('login_locked', { ip, userAgent: meta.client.userAgent, meta: { email: input.email } });
      throw Errors.tooMany(900, 'Слишком много неудачных попыток входа. Попробуйте через 15 минут или восстановите пароль.');
    }

    const [user] = await this.db.select().from(users).where(eq(users.email, input.email));
    dummyHash ??= await argon2.hash('dummy-password-for-timing', ARGON_OPTS);
    const ok = await argon2.verify(user?.passwordHash ?? dummyHash, input.password).catch(() => false);
    if (!user || !user.passwordHash || !ok) {
      await Promise.all([this.limiter.hit(accountKey, 1000, 900), this.limiter.hit(ipKey, 1000, 900)]);
      await this.security.record('login_failed', { userId: user?.id, ip, userAgent: meta.client.userAgent });
      throw Errors.unauthorized('Неверный email или пароль', 'invalid_credentials');
    }
    this.assertCanLogin(user);
    await this.limiter.reset(accountKey);
    await this.security.record('login_success', { userId: user.id, ip, userAgent: meta.client.userAgent, meta: { method: 'password' } });
    return this.issueSession(user.id, meta);
  }

  private assertCanLogin(user: typeof users.$inferSelect) {
    if (user.status === 'deleted') throw Errors.unauthorized('Аккаунт удалён', 'account_deleted');
    if (user.status === 'blocked' && !(user.blockedUntil && user.blockedUntil < new Date())) {
      throw Errors.forbidden(`Аккаунт заблокирован${user.blockedReason ? `: ${user.blockedReason}` : ''}`, 'account_blocked');
    }
  }

  async sendEmailVerification(userId: string, email: string, client: ClientInfo) {
    const token = randomToken(32);
    await this.db.insert(authCodes).values({
      type: 'email_verify',
      userId,
      target: email,
      codeHash: sha256(token),
      expiresAt: addDays(new Date(), 2),
      ip: client.ip,
    });
    const link = `${this.config.WEB_URL}/auth/verify-email?token=${token}`;
    await this.mail.send({
      to: email,
      subject: 'Подтвердите email на Лотке',
      text: `Здравствуйте!\n\nПодтвердите адрес электронной почты, перейдя по ссылке:\n${link}\n\nСсылка действует 48 часов. Если вы не регистрировались на Лотке, просто проигнорируйте это письмо.`,
    });
  }

  async resendVerification(email: string, client: ClientInfo) {
    const [user] = await this.db.select().from(users).where(eq(users.email, email));
    // Ответ одинаковый независимо от существования аккаунта.
    if (!user || user.emailVerifiedAt) return;
    await this.sendEmailVerification(user.id, email, client);
  }

  async verifyEmail(token: string) {
    const hash = sha256(token);
    const [code] = await this.db
      .select()
      .from(authCodes)
      .where(and(eq(authCodes.type, 'email_verify'), eq(authCodes.codeHash, hash), isNull(authCodes.consumedAt), gt(authCodes.expiresAt, new Date())));
    if (!code || !code.userId) throw Errors.badRequest('invalid_token', 'Ссылка недействительна или устарела');
    await this.db.transaction(async (tx) => {
      await tx.update(authCodes).set({ consumedAt: new Date() }).where(eq(authCodes.id, code.id));
      await tx
        .update(users)
        .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(users.id, code.userId!), eq(users.email, code.target)));
    });
  }

  async requestPasswordReset(email: string, client: ClientInfo) {
    const [user] = await this.db.select().from(users).where(eq(users.email, email));
    if (!user || user.status === 'deleted') return;
    const token = randomToken(32);
    await this.db.insert(authCodes).values({
      type: 'password_reset',
      userId: user.id,
      target: email,
      codeHash: sha256(token),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      ip: client.ip,
    });
    await this.mail.send({
      to: email,
      subject: 'Восстановление доступа к Лотку',
      text: `Для установки нового пароля перейдите по ссылке:\n${this.config.WEB_URL}/auth/reset-password?token=${token}\n\nСсылка действует 1 час. Если вы не запрашивали восстановление, проигнорируйте письмо — пароль останется прежним.`,
    });
    await this.security.record('password_reset_requested', { userId: user.id, ip: client.ip });
  }

  async resetPassword(token: string, password: string, client: ClientInfo) {
    const [code] = await this.db
      .select()
      .from(authCodes)
      .where(
        and(eq(authCodes.type, 'password_reset'), eq(authCodes.codeHash, sha256(token)), isNull(authCodes.consumedAt), gt(authCodes.expiresAt, new Date())),
      );
    if (!code?.userId) throw Errors.badRequest('invalid_token', 'Ссылка недействительна или устарела');
    const hash = await argon2.hash(password, ARGON_OPTS);
    await this.db.transaction(async (tx) => {
      await tx.update(authCodes).set({ consumedAt: new Date() }).where(eq(authCodes.id, code.id));
      await tx
        .update(users)
        .set({
          passwordHash: hash,
          // Владение почтой подтверждено ссылкой из письма.
          emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, now())`,
          tokenVersion: sql`${users.tokenVersion} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(users.id, code.userId!));
      await tx
        .update(sessions)
        .set({ revokedAt: new Date(), revokedReason: 'password_reset' })
        .where(and(eq(sessions.userId, code.userId!), isNull(sessions.revokedAt)));
    });
    await this.authState.invalidate(code.userId);
    await this.security.record('password_reset', { userId: code.userId, ip: client.ip });
  }

  async changePassword(userId: string, sessionId: string, current: string, next: string) {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!user?.passwordHash || !(await argon2.verify(user.passwordHash, current))) {
      throw Errors.badRequest('invalid_password', 'Текущий пароль указан неверно');
    }
    const hash = await argon2.hash(next, ARGON_OPTS);
    await this.db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash: hash, updatedAt: new Date() }).where(eq(users.id, userId));
      // Остальные сессии завершаются — текущая остаётся.
      await tx
        .update(sessions)
        .set({ revokedAt: new Date(), revokedReason: 'password_changed' })
        .where(and(eq(sessions.userId, userId), ne(sessions.id, sessionId), isNull(sessions.revokedAt)));
    });
    await this.security.record('password_changed', { userId });
  }

  /* ---------------------------- телефон / SMS ---------------------------- */

  async requestPhoneCode(phone: string, client: ClientInfo, type: 'phone_login' | 'phone_attach' = 'phone_login', userId?: string) {
    const perPhoneMinute = await this.limiter.hit(`sms:min:${phone}`, 1, 60);
    if (!perPhoneMinute.allowed) throw Errors.tooMany(perPhoneMinute.retryAfterSec, 'Повторно запросить код можно через минуту');
    const perPhoneHour = await this.limiter.hit(`sms:hour:${phone}`, 5, 3600);
    const perIp = await this.limiter.hit(`sms:ip:${client.ip}`, 20, 3600);
    if (!perPhoneHour.allowed || !perIp.allowed) {
      await this.security.record('sms_rate_limited', { ip: client.ip, meta: { phone } });
      throw Errors.tooMany(3600, 'Превышен лимит SMS. Попробуйте позже.');
    }
    const code = randomDigits(6);
    await this.db.insert(authCodes).values({
      type,
      userId: userId ?? null,
      target: phone,
      codeHash: sha256(`${phone}:${code}:${this.config.APP_SIGNING_SECRET}`),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      ip: client.ip,
    });
    await this.sms.send(phone, `Код для входа в Лоток: ${code}. Никому его не сообщайте.`);
    return { expiresInSec: 300, resendInSec: 60 };
  }

  /** Проверка последнего выданного кода: не более 5 попыток, затем код аннулируется. */
  async consumePhoneCode(phone: string, code: string, type: 'phone_login' | 'phone_attach', userId?: string) {
    const [row] = await this.db
      .select()
      .from(authCodes)
      .where(and(eq(authCodes.type, type), eq(authCodes.target, phone), isNull(authCodes.consumedAt), gt(authCodes.expiresAt, new Date())))
      .orderBy(desc(authCodes.createdAt))
      .limit(1);
    if (!row || (type === 'phone_attach' && row.userId !== userId)) throw Errors.badRequest('invalid_code', 'Код недействителен. Запросите новый.');
    if (row.attempts >= 5) throw Errors.badRequest('code_attempts_exceeded', 'Превышено число попыток. Запросите новый код.');
    const ok = row.codeHash === sha256(`${phone}:${code}:${this.config.APP_SIGNING_SECRET}`);
    if (!ok) {
      await this.db
        .update(authCodes)
        .set({ attempts: sql`${authCodes.attempts} + 1` })
        .where(eq(authCodes.id, row.id));
      throw Errors.badRequest('invalid_code', 'Неверный код');
    }
    const [consumed] = await this.db
      .update(authCodes)
      .set({ consumedAt: new Date() })
      .where(and(eq(authCodes.id, row.id), isNull(authCodes.consumedAt)))
      .returning({ id: authCodes.id });
    if (!consumed) throw Errors.badRequest('invalid_code', 'Код уже использован');
  }

  async verifyPhoneLogin(
    input: { phone: string; code: string; acceptTerms?: boolean; displayName?: string },
    meta: SessionMeta,
  ): Promise<IssuedTokens & { isNew: boolean }> {
    const [existing] = await this.db.select().from(users).where(eq(users.phone, input.phone));
    if (!existing && !input.acceptTerms) {
      // Проверяем согласие до списания кода, чтобы пользователь не запрашивал новый.
      throw Errors.unprocessable('terms_required', 'Для регистрации примите условия использования и согласие на обработку персональных данных');
    }
    await this.consumePhoneCode(input.phone, input.code, 'phone_login');
    let userId: string;
    let isNew = false;
    if (existing) {
      this.assertCanLogin(existing);
      userId = existing.id;
      if (!existing.phoneVerifiedAt) await this.db.update(users).set({ phoneVerifiedAt: new Date() }).where(eq(users.id, userId));
    } else {
      const now = new Date();
      const [created] = await this.db
        .insert(users)
        .values({
          phone: input.phone,
          phoneVerifiedAt: now,
          displayName: input.displayName ?? `Пользователь ${input.phone.slice(-4)}`,
          termsAcceptedAt: now,
          personalDataConsentAt: now,
        })
        .returning({ id: users.id });
      userId = created.id;
      isNew = true;
    }
    await this.security.record('login_success', { userId, ip: meta.client.ip, userAgent: meta.client.userAgent, meta: { method: 'sms' } });
    return { ...(await this.issueSession(userId, meta)), isNew };
  }

  async attachPhone(userId: string, phone: string, code: string) {
    const [taken] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.phone, phone), ne(users.id, userId)));
    if (taken) throw Errors.conflict('phone_taken', 'Этот номер уже привязан к другому аккаунту');
    await this.consumePhoneCode(phone, code, 'phone_attach', userId);
    await this.db.update(users).set({ phone, phoneVerifiedAt: new Date(), updatedAt: new Date() }).where(eq(users.id, userId));
  }

  /* ---------------------------- сессии ---------------------------- */

  async issueSession(userId: string, meta: SessionMeta): Promise<IssuedTokens> {
    const refreshToken = randomToken(48);
    const [s] = await this.db
      .insert(sessions)
      .values({
        userId,
        refreshTokenHash: sha256(refreshToken),
        platform: meta.platform ?? 'web',
        deviceName: meta.deviceName ?? null,
        userAgent: meta.client.userAgent,
        ip: meta.client.ip,
        expiresAt: addDays(new Date(), this.config.REFRESH_TTL_DAYS),
      })
      .returning();
    const [u] = await this.db.select({ tv: users.tokenVersion }).from(users).where(eq(users.id, userId));
    await this.db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, userId));
    const accessToken = this.authState.signAccess({ sub: userId, sid: s.id, tv: u.tv });
    return {
      accessToken,
      refreshToken,
      sessionId: s.id,
      expiresIn: this.config.JWT_ACCESS_TTL_SEC,
      user: await this.users.getMe(userId),
    };
  }

  /**
   * Ротация refresh-токена. Повторное предъявление уже заменённого токена
   * (кроме короткого окна гонки параллельных вкладок) расценивается как кража — сессия отзывается.
   */
  async refresh(refreshToken: string, client: ClientInfo): Promise<{ tokens: IssuedTokens | null; accessOnly?: AuthResponse }> {
    const hash = sha256(refreshToken);
    const now = new Date();
    const [current] = await this.db.select().from(sessions).where(eq(sessions.refreshTokenHash, hash));
    if (!current) {
      const [reused] = await this.db.select().from(sessions).where(eq(sessions.previousTokenHash, hash));
      if (reused && !reused.revokedAt) {
        const graceMs = 30_000;
        if (now.getTime() - reused.lastUsedAt.getTime() < graceMs) {
          const [u] = await this.db.select({ tv: users.tokenVersion }).from(users).where(eq(users.id, reused.userId));
          return {
            tokens: null,
            accessOnly: {
              accessToken: this.authState.signAccess({ sub: reused.userId, sid: reused.id, tv: u.tv }),
              expiresIn: this.config.JWT_ACCESS_TTL_SEC,
              user: await this.users.getMe(reused.userId),
            },
          };
        }
        await this.revokeSession(reused.userId, reused.id, 'token_reuse');
        await this.security.record('refresh_token_reuse', { userId: reused.userId, ip: client.ip, userAgent: client.userAgent, meta: { sessionId: reused.id } });
      }
      throw Errors.unauthorized('Сессия недействительна, войдите снова', 'session_invalid');
    }
    if (current.revokedAt || current.expiresAt < now) throw Errors.unauthorized('Сессия завершена, войдите снова', 'session_invalid');
    const state = await this.authState.getState(current.userId);
    if (!state || state.status === 'deleted' || (state.status === 'blocked' && !(state.blockedUntil && new Date(state.blockedUntil) < now))) {
      throw Errors.unauthorized('Аккаунт недоступен', 'account_unavailable');
    }
    const next = randomToken(48);
    const [updated] = await this.db
      .update(sessions)
      .set({ refreshTokenHash: sha256(next), previousTokenHash: hash, lastUsedAt: now, ip: client.ip, expiresAt: addDays(now, this.config.REFRESH_TTL_DAYS) })
      .where(and(eq(sessions.id, current.id), eq(sessions.refreshTokenHash, hash)))
      .returning({ id: sessions.id });
    if (!updated) throw Errors.conflict('concurrent_refresh', 'Повторите запрос');
    await this.db.update(users).set({ lastSeenAt: now }).where(eq(users.id, current.userId));
    return {
      tokens: {
        accessToken: this.authState.signAccess({ sub: current.userId, sid: current.id, tv: state.tv }),
        refreshToken: next,
        sessionId: current.id,
        expiresIn: this.config.JWT_ACCESS_TTL_SEC,
        user: await this.users.getMe(current.userId),
      },
    };
  }

  async revokeSession(userId: string, sessionId: string, reason = 'logout') {
    const res = await this.db
      .update(sessions)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });
    await this.authState.revokeSessionAccess(sessionId);
    return res.length > 0;
  }

  /** Выход со всех устройств: отзыв всех сессий и инвалидация всех access-токенов. */
  async revokeAll(userId: string) {
    await this.db.transaction(async (tx) => {
      await tx
        .update(sessions)
        .set({ revokedAt: new Date(), revokedReason: 'logout_all' })
        .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
      await tx
        .update(users)
        .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
        .where(eq(users.id, userId));
    });
    await this.authState.invalidate(userId);
    await this.security.record('logout_all', { userId });
  }
}
