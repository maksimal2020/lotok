import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, gt, inArray, isNull, max, sql } from 'drizzle-orm';
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_GROUPS,
  permissionsForRoles,
  type Me,
  type NotificationPreferenceDto,
  type PublicUser,
  type UpdateProfileInput,
} from '@lotok/shared';
import { DB, type Db } from '../../database/database.module';
import {
  ledgerAccounts,
  listings,
  media,
  notificationPreferences,
  organizationMembers,
  organizations,
  pushTokens,
  regions,
  sessions,
  userBlocks,
  userRoles,
  userSubscriptions,
  users,
} from '../../database/schema';
import { StorageService } from '../../infra/storage.service';
import { mediaUrls } from '../media/media.presenter';
import { Errors } from '../../common/errors';
import { iso } from '../../common/util';
import { AuthStateService } from '../auth/auth-state.service';

/** Каналы уведомлений, включённые по умолчанию для каждой группы. */
export const DEFAULT_PREFERENCES: Record<string, string[]> = {
  messages: ['in_app', 'push'],
  orders: ['in_app', 'push', 'email'],
  listings: ['in_app', 'email'],
  saved_searches: ['in_app', 'push'],
  billing: ['in_app', 'email'],
  marketing: [],
  security: ['in_app', 'email'],
};

@Injectable()
export class UsersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly storage: StorageService,
    private readonly authState: AuthStateService,
  ) {}

  async getMe(userId: string): Promise<Me> {
    const [u] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!u) throw Errors.notFound('Пользователь');
    const [roles, orgs, avatar, bonus, pro] = await Promise.all([
      this.db.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, userId)),
      this.db
        .select({ id: organizations.id, name: organizations.name, role: organizationMembers.role })
        .from(organizationMembers)
        .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
        .where(eq(organizationMembers.userId, userId)),
      u.avatarMediaId ? this.db.select().from(media).where(eq(media.id, u.avatarMediaId)) : Promise.resolve([]),
      this.db
        .select({ balance: ledgerAccounts.balance })
        .from(ledgerAccounts)
        .where(and(eq(ledgerAccounts.userId, userId), eq(ledgerAccounts.type, 'user_bonus'))),
      this.db
        .select({ until: max(userSubscriptions.endsAt) })
        .from(userSubscriptions)
        .where(and(eq(userSubscriptions.userId, userId), eq(userSubscriptions.serviceType, 'pro_subscription'), gt(userSubscriptions.endsAt, new Date()))),
    ]);
    const roleList = roles.map((r) => r.role);
    return {
      id: u.id,
      email: u.email,
      emailVerified: !!u.emailVerifiedAt,
      phone: u.phone,
      phoneVerified: !!u.phoneVerifiedAt,
      displayName: u.displayName,
      about: u.about,
      avatarUrl: mediaUrls(this.storage, avatar[0])?.thumb ?? null,
      cityId: u.cityId,
      roles: roleList,
      permissions: [...permissionsForRoles(roleList)],
      showPhone: u.showPhone,
      ratingAvg: u.ratingAvg,
      ratingCount: u.ratingCount,
      bonusBalance: bonus[0]?.balance ?? 0,
      createdAt: u.createdAt.toISOString(),
      organizations: orgs,
      proUntil: pro[0]?.until ? new Date(pro[0].until).toISOString() : null,
    };
  }

  async getPublic(userId: string): Promise<PublicUser> {
    const [u] = await this.db
      .select({
        id: users.id,
        displayName: users.displayName,
        avatarMediaId: users.avatarMediaId,
        ratingAvg: users.ratingAvg,
        ratingCount: users.ratingCount,
        createdAt: users.createdAt,
        status: users.status,
        lastSeenAt: users.lastSeenAt,
      })
      .from(users)
      .where(eq(users.id, userId));
    if (!u || u.status === 'deleted') throw Errors.notFound('Пользователь');
    const [[active], avatar, org, pro] = await Promise.all([
      this.db
        .select({ n: count() })
        .from(listings)
        .where(and(eq(listings.userId, userId), eq(listings.status, 'active'))),
      u.avatarMediaId ? this.db.select().from(media).where(eq(media.id, u.avatarMediaId)) : Promise.resolve([]),
      this.db
        .select({ id: organizations.id, name: organizations.name, verifiedAt: organizations.verifiedAt })
        .from(organizations)
        .where(and(eq(organizations.ownerId, userId), eq(organizations.status, 'active')))
        .limit(1),
      this.isPro(userId),
    ]);
    return {
      id: u.id,
      displayName: u.displayName,
      avatarUrl: mediaUrls(this.storage, avatar[0])?.thumb ?? null,
      ratingAvg: u.ratingAvg,
      ratingCount: u.ratingCount,
      createdAt: u.createdAt.toISOString(),
      activeListings: active.n,
      isPro: pro,
      organization: org[0] ? { id: org[0].id, name: org[0].name, verified: !!org[0].verifiedAt } : null,
      lastSeenAt: iso(u.lastSeenAt),
    };
  }

  async isPro(userId: string): Promise<boolean> {
    const [r] = await this.db
      .select({ n: count() })
      .from(userSubscriptions)
      .where(and(eq(userSubscriptions.userId, userId), eq(userSubscriptions.serviceType, 'pro_subscription'), gt(userSubscriptions.endsAt, new Date())));
    return r.n > 0;
  }

  async updateProfile(userId: string, input: UpdateProfileInput) {
    if (input.cityId) {
      const [r] = await this.db.select({ id: regions.id }).from(regions).where(eq(regions.id, input.cityId));
      if (!r) throw Errors.badRequest('invalid_city', 'Город не найден');
    }
    if (input.avatarMediaId) {
      const [m] = await this.db.select().from(media).where(eq(media.id, input.avatarMediaId));
      if (!m || m.ownerId !== userId || m.kind !== 'image') throw Errors.badRequest('invalid_media', 'Изображение не найдено');
    }
    await this.db
      .update(users)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(users.id, userId));
    return this.getMe(userId);
  }

  async listSessions(userId: string, currentSessionId: string) {
    const rows = await this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
      .orderBy(desc(sessions.lastUsedAt));
    return rows.map((s) => ({
      id: s.id,
      platform: s.platform,
      deviceName: s.deviceName,
      userAgent: s.userAgent,
      ip: s.ip,
      createdAt: s.createdAt.toISOString(),
      lastUsedAt: s.lastUsedAt.toISOString(),
      current: s.id === currentSessionId,
    }));
  }

  async getPreferences(userId: string): Promise<NotificationPreferenceDto[]> {
    const rows = await this.db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, userId));
    const out: NotificationPreferenceDto[] = [];
    for (const group of NOTIFICATION_GROUPS) {
      for (const channel of NOTIFICATION_CHANNELS) {
        const row = rows.find((r) => r.group === group && r.channel === channel);
        out.push({ group, channel, enabled: row ? row.enabled : DEFAULT_PREFERENCES[group].includes(channel) });
      }
    }
    return out;
  }

  async setPreferences(userId: string, prefs: NotificationPreferenceDto[]) {
    for (const p of prefs) {
      // Уведомления безопасности в приложении нельзя отключить: пользователь должен узнать о входе с нового устройства.
      if (p.group === 'security' && p.channel === 'in_app' && !p.enabled) continue;
      await this.db
        .insert(notificationPreferences)
        .values({ userId, group: p.group, channel: p.channel, enabled: p.enabled })
        .onConflictDoUpdate({
          target: [notificationPreferences.userId, notificationPreferences.group, notificationPreferences.channel],
          set: { enabled: p.enabled },
        });
    }
    return this.getPreferences(userId);
  }

  async registerPushToken(userId: string, token: string, platform: 'web' | 'ios' | 'android') {
    await this.db
      .insert(pushTokens)
      .values({ userId, token, platform })
      .onConflictDoUpdate({ target: pushTokens.token, set: { userId, platform, lastUsedAt: new Date() } });
  }

  async removePushToken(userId: string, token: string) {
    await this.db.delete(pushTokens).where(and(eq(pushTokens.userId, userId), eq(pushTokens.token, token)));
  }

  async block(userId: string, targetId: string) {
    if (userId === targetId) throw Errors.badRequest('self_block', 'Нельзя заблокировать себя');
    const [t] = await this.db.select({ id: users.id }).from(users).where(eq(users.id, targetId));
    if (!t) throw Errors.notFound('Пользователь');
    await this.db.insert(userBlocks).values({ blockerId: userId, blockedId: targetId }).onConflictDoNothing();
  }

  async unblock(userId: string, targetId: string) {
    await this.db.delete(userBlocks).where(and(eq(userBlocks.blockerId, userId), eq(userBlocks.blockedId, targetId)));
  }

  async listBlocked(userId: string) {
    return this.db
      .select({ id: users.id, displayName: users.displayName, blockedAt: userBlocks.createdAt })
      .from(userBlocks)
      .innerJoin(users, eq(users.id, userBlocks.blockedId))
      .where(eq(userBlocks.blockerId, userId));
  }

  async isBlockedEitherWay(a: string, b: string): Promise<{ aBlockedB: boolean; bBlockedA: boolean }> {
    const rows = await this.db
      .select()
      .from(userBlocks)
      .where(
        sql`(${userBlocks.blockerId} = ${a} AND ${userBlocks.blockedId} = ${b}) OR (${userBlocks.blockerId} = ${b} AND ${userBlocks.blockedId} = ${a})`,
      );
    return { aBlockedB: rows.some((r) => r.blockerId === a), bBlockedA: rows.some((r) => r.blockerId === b) };
  }

  /**
   * Удаление аккаунта по запросу субъекта ПДн (152-ФЗ): обезличивание персональных данных,
   * снятие объявлений, отзыв сессий. Финансовые записи сохраняются (требования бухучёта).
   */
  async deleteAccount(userId: string) {
    await this.db.transaction(async (tx) => {
      await tx
        .update(listings)
        .set({ status: 'deleted', deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(listings.userId, userId), inArray(listings.status, ['draft', 'moderation', 'active', 'inactive', 'rejected', 'expired', 'sold', 'archived'])));
      await tx
        .update(users)
        .set({
          status: 'deleted',
          email: null,
          phone: null,
          passwordHash: null,
          displayName: 'Удалённый пользователь',
          about: null,
          avatarMediaId: null,
          deletedAt: new Date(),
          tokenVersion: sql`${users.tokenVersion} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));
      await tx.update(sessions).set({ revokedAt: new Date(), revokedReason: 'account_deleted' }).where(eq(sessions.userId, userId));
      await tx.delete(pushTokens).where(eq(pushTokens.userId, userId));
    });
    await this.authState.invalidate(userId);
  }

  async touchLastSeen(userId: string) {
    await this.db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, userId));
  }
}
