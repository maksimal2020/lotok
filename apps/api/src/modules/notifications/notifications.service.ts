import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { and, count, desc, eq, inArray, isNull, lt } from 'drizzle-orm';
import type { NotificationDto, NotificationGroup } from '@lotok/shared';
import { DB, type Db } from '../../database/database.module';
import { notificationPreferences, notifications, pushTokens, users } from '../../database/schema';
import { JobsService } from '../../infra/jobs.service';
import { MailService, PushService, SmsService } from '../../infra/messaging.providers';
import { RealtimeService } from '../../infra/platform.services';
import { DEFAULT_PREFERENCES } from '../users/users.service';
import { Errors } from '../../common/errors';

export interface NotifyInput {
  type: string;
  group: NotificationGroup;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /** Не сохранять во «входящих» (например, push о новом сообщении — оно и так в чате). */
  skipInApp?: boolean;
}

const toDto = (n: typeof notifications.$inferSelect): NotificationDto => ({
  id: n.id,
  type: n.type,
  group: n.group,
  title: n.title,
  body: n.body,
  data: n.data,
  readAt: n.readAt?.toISOString() ?? null,
  createdAt: n.createdAt.toISOString(),
});

/**
 * Единая точка уведомлений: in-app (БД + WebSocket) синхронно, email/push/SMS — через очередь
 * с учётом пользовательских настроек каналов.
 */
@Injectable()
export class NotificationsService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly jobs: JobsService,
    private readonly realtime: RealtimeService,
    private readonly mail: MailService,
    private readonly push: PushService,
    private readonly sms: SmsService,
  ) {}

  onModuleInit() {
    this.jobs.register('notify.email', (d: { userId: string; title: string; body: string }) => this.deliverEmail(d));
    this.jobs.register('notify.push', (d: { userId: string; title: string; body: string; data: Record<string, unknown> }) => this.deliverPush(d));
    this.jobs.register('notify.sms', async (d: { phone: string; text: string }) => this.sms.send(d.phone, d.text));
  }

  async channelsFor(userId: string, group: NotificationGroup): Promise<Set<string>> {
    const rows = await this.db
      .select()
      .from(notificationPreferences)
      .where(and(eq(notificationPreferences.userId, userId), eq(notificationPreferences.group, group)));
    const set = new Set(DEFAULT_PREFERENCES[group]);
    for (const r of rows) {
      if (r.enabled) set.add(r.channel);
      else set.delete(r.channel);
    }
    return set;
  }

  async notify(userId: string, input: NotifyInput) {
    const channels = await this.channelsFor(userId, input.group);
    if (channels.has('in_app') && !input.skipInApp) {
      const [row] = await this.db
        .insert(notifications)
        .values({ userId, type: input.type, group: input.group, title: input.title, body: input.body, data: input.data ?? {} })
        .returning();
      this.realtime.toUser(userId, 'notification:new', toDto(row));
    }
    if (channels.has('push')) await this.jobs.enqueue('notify.push', { userId, title: input.title, body: input.body, data: { type: input.type, ...(input.data ?? {}) } });
    if (channels.has('email')) await this.jobs.enqueue('notify.email', { userId, title: input.title, body: input.body });
  }

  private async deliverEmail(d: { userId: string; title: string; body: string }) {
    const [u] = await this.db.select({ email: users.email, verified: users.emailVerifiedAt, status: users.status }).from(users).where(eq(users.id, d.userId));
    if (!u?.email || !u.verified || u.status !== 'active') return;
    await this.mail.send({ to: u.email, subject: d.title, text: `${d.body}\n\n—\nЛоток. Настроить уведомления можно в профиле.` });
  }

  private async deliverPush(d: { userId: string; title: string; body: string; data: Record<string, unknown> }) {
    const tokens = await this.db.select({ token: pushTokens.token }).from(pushTokens).where(eq(pushTokens.userId, d.userId));
    const invalid = await this.push.send({ tokens: tokens.map((t) => t.token), title: d.title, body: d.body, data: d.data });
    if (invalid.length) await this.db.delete(pushTokens).where(inArray(pushTokens.token, invalid));
  }

  async list(userId: string, cursor: string | undefined, limit: number) {
    const cond = cursor ? and(eq(notifications.userId, userId), lt(notifications.createdAt, new Date(cursor))) : eq(notifications.userId, userId);
    const rows = await this.db.select().from(notifications).where(cond).orderBy(desc(notifications.createdAt)).limit(limit + 1);
    const items = rows.slice(0, limit).map(toDto);
    return { items, nextCursor: rows.length > limit ? items[items.length - 1].createdAt : null };
  }

  async unreadCount(userId: string) {
    const [r] = await this.db
      .select({ n: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    return r.n;
  }

  async markRead(userId: string, ids: string[] | 'all') {
    const cond =
      ids === 'all'
        ? and(eq(notifications.userId, userId), isNull(notifications.readAt))
        : and(eq(notifications.userId, userId), inArray(notifications.id, ids), isNull(notifications.readAt));
    await this.db.update(notifications).set({ readAt: new Date() }).where(cond);
  }

  async remove(userId: string, id: string) {
    const r = await this.db
      .delete(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.id, id)))
      .returning({ id: notifications.id });
    if (!r.length) throw Errors.notFound('Уведомление');
  }
}
