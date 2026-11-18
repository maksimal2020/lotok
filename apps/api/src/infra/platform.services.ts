import { Inject, Injectable, Logger } from '@nestjs/common';
import { Emitter } from '@socket.io/redis-emitter';
import { eq } from 'drizzle-orm';
import Redis from 'ioredis';
import { DB, type Db, type DbOrTx } from '../database/database.module';
import { auditLogs, platformSettings, securityEvents } from '../database/schema';
import { REDIS } from './redis.module';

/** Рассылка событий реального времени через Redis — работает из любого процесса (API или worker). */
@Injectable()
export class RealtimeService {
  private readonly emitter: Emitter;
  constructor(@Inject(REDIS) redis: Redis) {
    this.emitter = new Emitter(redis);
  }

  toUser(userId: string, event: string, payload: unknown) {
    this.emitter.to(`user:${userId}`).emit(event, payload);
  }

  toUsers(userIds: string[], event: string, payload: unknown) {
    if (!userIds.length) return;
    this.emitter.to(userIds.map((id) => `user:${id}`)).emit(event, payload);
  }
}

export interface AuditContext {
  actorId: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

/** Журнал действий администраторов и критичных операций. Записи не редактируются и не удаляются через API. */
@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async log(
    ctx: AuditContext,
    action: string,
    entityType: string,
    entityId: string | number | null,
    before?: unknown,
    after?: unknown,
    tx: DbOrTx = this.db,
  ) {
    await tx.insert(auditLogs).values({
      actorId: ctx.actorId,
      action,
      entityType,
      entityId: entityId === null ? null : String(entityId),
      before: before === undefined ? null : (before as object),
      after: after === undefined ? null : (after as object),
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
    });
  }
}

/** События безопасности: входы, неудачные попытки, повторное использование токенов, подозрительная активность. */
@Injectable()
export class SecurityEventsService {
  private readonly logger = new Logger('Security');
  constructor(@Inject(DB) private readonly db: Db) {}

  async record(type: string, data: { userId?: string | null; ip?: string | null; userAgent?: string | null; meta?: Record<string, unknown> }) {
    this.logger.log({ type, userId: data.userId, ip: data.ip, meta: data.meta }, 'security_event');
    await this.db.insert(securityEvents).values({
      type,
      userId: data.userId ?? null,
      ip: data.ip ?? null,
      userAgent: data.userAgent ?? null,
      meta: data.meta ?? {},
    });
  }
}

/** Значения по умолчанию для настроек платформы, управляемых из админки. */
export const DEFAULT_SETTINGS = {
  'listings.ttl_days': 30,
  'listings.default_free_limit': null as number | null,
  'listings.new_user_manual_moderation_hours': 24,
  'orders.commission_bp': 500,
  'orders.auto_complete_days': 7,
  'orders.unpaid_cancel_minutes': 60,
  'complaints.auto_remoderate_threshold': 3,
  'reviews.require_completed_order': false,
  'chat.max_messages_per_minute': 30,
  'bonus.welcome_amount': 0,
  'platform.maintenance': false,
} as const;
export type SettingKey = keyof typeof DEFAULT_SETTINGS;

@Injectable()
export class SettingsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async get<K extends SettingKey>(key: K): Promise<(typeof DEFAULT_SETTINGS)[K]> {
    const cached = await this.redis.get(`setting:${key}`);
    if (cached !== null) return JSON.parse(cached);
    const [row] = await this.db.select().from(platformSettings).where(eq(platformSettings.key, key));
    const value = row ? row.value : DEFAULT_SETTINGS[key];
    await this.redis.set(`setting:${key}`, JSON.stringify(value), 'EX', 30);
    return value as (typeof DEFAULT_SETTINGS)[K];
  }

  async all(): Promise<Record<string, unknown>> {
    const rows = await this.db.select().from(platformSettings);
    const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
    for (const r of rows) out[r.key] = r.value;
    return out;
  }

  async set(key: SettingKey, value: unknown, actorId: string) {
    await this.db
      .insert(platformSettings)
      .values({ key, value: value as object, updatedBy: actorId })
      .onConflictDoUpdate({ target: platformSettings.key, set: { value: value as object, updatedBy: actorId, updatedAt: new Date() } });
    await this.redis.del(`setting:${key}`);
  }
}
