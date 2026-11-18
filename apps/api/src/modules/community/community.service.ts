import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
import type { ComplaintDto, ReviewDto } from '@lotok/shared';
import { DB, type Db, type DbOrTx } from '../../database/database.module';
import { complaints, conversations, listings, media, messages, orders, reviews, users } from '../../database/schema';
import { SettingsService } from '../../infra/platform.services';
import { StorageService } from '../../infra/storage.service';
import { Errors } from '../../common/errors';
import { paginate } from '../../common/util';
import { mediaUrls } from '../media/media.presenter';
import { ListingsService } from '../listings/listings.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class CommunityService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly listings: ListingsService,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
    private readonly storage: StorageService,
  ) {}

  /* ------------------------------ отзывы ------------------------------ */

  /**
   * Правила: отзыв о другой стороне сделки после завершённого заказа (покупатель ↔ продавец),
   * либо покупатель о продавце после переписки по объявлению, где ответили обе стороны
   * (если настройка reviews.require_completed_order выключена). Один отзыв на объявление от автора.
   */
  async createReview(authorId: string, input: { orderId?: string; listingId?: string; rating: number; text: string }) {
    let targetUserId: string;
    let listingId: string;
    let authorRole: 'buyer' | 'seller';
    let orderId: string | null = null;
    if (input.orderId) {
      const [o] = await this.db.select().from(orders).where(eq(orders.id, input.orderId));
      if (!o || (o.buyerId !== authorId && o.sellerId !== authorId)) throw Errors.notFound('Заказ');
      if (o.status !== 'completed') throw Errors.forbidden('Отзыв можно оставить после завершения заказа', 'order_not_completed');
      authorRole = o.buyerId === authorId ? 'buyer' : 'seller';
      targetUserId = authorRole === 'buyer' ? o.sellerId : o.buyerId;
      listingId = o.listingId;
      orderId = o.id;
    } else {
      if (await this.settings.get('reviews.require_completed_order')) throw Errors.forbidden('Отзыв можно оставить только после сделки', 'order_required');
      const listing = await this.listings.getRow(input.listingId!);
      const [conv] = await this.db
        .select()
        .from(conversations)
        .where(and(eq(conversations.listingId, listing.id), eq(conversations.buyerId, authorId)));
      if (!conv) throw Errors.forbidden('Отзыв доступен после общения с продавцом', 'no_interaction');
      const senders = await this.db
        .selectDistinct({ s: messages.senderId })
        .from(messages)
        .where(eq(messages.conversationId, conv.id));
      if (!senders.some((s) => s.s === authorId) || !senders.some((s) => s.s === listing.userId)) {
        throw Errors.forbidden('Отзыв доступен после того, как продавец ответит вам', 'no_interaction');
      }
      targetUserId = listing.userId;
      listingId = listing.id;
      authorRole = 'buyer';
    }
    const id = await this.db.transaction(async (tx) => {
      const [r] = await tx
        .insert(reviews)
        .values({ authorId, targetUserId, listingId, orderId, authorRole, rating: input.rating, text: input.text })
        .onConflictDoNothing()
        .returning({ id: reviews.id });
      if (!r) throw Errors.conflict('review_exists', 'Вы уже оставили отзыв по этому объявлению');
      await this.recalcRating(tx, targetUserId);
      return r.id;
    });
    await this.notifications.notify(targetUserId, {
      type: 'review.new',
      group: 'listings',
      title: 'Новый отзыв',
      body: `Вам поставили оценку ${input.rating} из 5.`,
      data: { reviewId: id },
    });
    return (await this.presentReviews(await this.db.select().from(reviews).where(eq(reviews.id, id))))[0];
  }

  async recalcRating(tx: DbOrTx, userId: string) {
    await tx.execute(sql`
      UPDATE users SET
        rating_avg = (SELECT round(avg(rating)::numeric, 2) FROM reviews WHERE target_user_id = ${userId} AND status = 'published'),
        rating_count = (SELECT count(*) FROM reviews WHERE target_user_id = ${userId} AND status = 'published')
      WHERE id = ${userId}`);
  }

  private async presentReviews(rows: (typeof reviews.$inferSelect)[]): Promise<ReviewDto[]> {
    if (!rows.length) return [];
    const authors = await this.db
      .select({ id: users.id, displayName: users.displayName, avatar: users.avatarMediaId })
      .from(users)
      .where(inArray(users.id, rows.map((r) => r.authorId)));
    const avatarIds = authors.map((a) => a.avatar).filter((x): x is string => !!x);
    const avatars = avatarIds.length ? await this.db.select().from(media).where(inArray(media.id, avatarIds)) : [];
    const lids = rows.map((r) => r.listingId).filter((x): x is string => !!x);
    const ls = lids.length ? await this.db.select({ id: listings.id, title: listings.title }).from(listings).where(inArray(listings.id, lids)) : [];
    return rows.map((r) => {
      const a = authors.find((x) => x.id === r.authorId);
      return {
        id: r.id,
        rating: r.rating,
        text: r.text,
        author: { id: r.authorId, displayName: a?.displayName ?? '', avatarUrl: mediaUrls(this.storage, avatars.find((m) => m.id === a?.avatar))?.thumb ?? null },
        listing: ls.find((l) => l.id === r.listingId) ?? null,
        role: r.authorRole as 'buyer' | 'seller',
        createdAt: r.createdAt.toISOString(),
        status: r.status,
      };
    });
  }

  async userReviews(userId: string, page: number, limit: number) {
    const { offset } = paginate(page, limit);
    const cond = and(eq(reviews.targetUserId, userId), eq(reviews.status, 'published'));
    const [rows, [{ total }], dist] = await Promise.all([
      this.db.select().from(reviews).where(cond).orderBy(desc(reviews.createdAt)).limit(limit).offset(offset),
      this.db.select({ total: count() }).from(reviews).where(cond),
      this.db.select({ rating: reviews.rating, n: count() }).from(reviews).where(cond).groupBy(reviews.rating),
    ]);
    return { items: await this.presentReviews(rows), total, page, limit, distribution: Object.fromEntries(dist.map((d) => [d.rating, d.n])) };
  }

  async setReviewStatus(id: string, status: 'published' | 'hidden') {
    const [r] = await this.db.update(reviews).set({ status, updatedAt: new Date() }).where(eq(reviews.id, id)).returning();
    if (!r) throw Errors.notFound('Отзыв');
    await this.recalcRating(this.db, r.targetUserId);
    return r;
  }

  /* ------------------------------ жалобы ------------------------------ */

  async createComplaint(reporterId: string, input: { targetType: 'listing' | 'user' | 'message' | 'review'; targetId: string; reason: ComplaintDto['reason']; comment?: string }) {
    // Проверка существования цели и права пожаловаться (на сообщение — только участник диалога).
    switch (input.targetType) {
      case 'listing': {
        const l = await this.listings.getRow(input.targetId);
        if (l.userId === reporterId) throw Errors.badRequest('own_listing', 'Нельзя пожаловаться на своё объявление');
        break;
      }
      case 'user': {
        const [u] = await this.db.select({ id: users.id }).from(users).where(eq(users.id, input.targetId));
        if (!u || u.id === reporterId) throw Errors.notFound('Пользователь');
        break;
      }
      case 'message': {
        const [m] = await this.db
          .select({ m: messages, c: conversations })
          .from(messages)
          .innerJoin(conversations, eq(conversations.id, messages.conversationId))
          .where(eq(messages.id, input.targetId));
        if (!m || (m.c.buyerId !== reporterId && m.c.sellerId !== reporterId) || m.m.senderId === reporterId) throw Errors.notFound('Сообщение');
        break;
      }
      case 'review': {
        const [r] = await this.db.select({ id: reviews.id }).from(reviews).where(eq(reviews.id, input.targetId));
        if (!r) throw Errors.notFound('Отзыв');
        break;
      }
    }
    const [c] = await this.db
      .insert(complaints)
      .values({ reporterId, targetType: input.targetType, targetId: input.targetId, reason: input.reason, comment: input.comment ?? null })
      .onConflictDoNothing()
      .returning();
    if (!c) throw Errors.conflict('complaint_exists', 'Вы уже отправили жалобу, она рассматривается');
    // Автоматическая реакция: при N открытых жалобах объявление снимается на повторную модерацию.
    if (input.targetType === 'listing') {
      const threshold = await this.settings.get('complaints.auto_remoderate_threshold');
      const [{ n }] = await this.db
        .select({ n: count() })
        .from(complaints)
        .where(and(eq(complaints.targetType, 'listing'), eq(complaints.targetId, input.targetId), inArray(complaints.status, ['new', 'in_review'])));
      if (n >= threshold) {
        const l = await this.listings.getRow(input.targetId);
        if (l.status === 'active') await this.listings.transition(l.id, 'moderation', 'system', { reason: 'complaints_threshold' });
      }
    }
    return this.presentComplaint(c);
  }

  presentComplaint(c: typeof complaints.$inferSelect, reporter?: { id: string; displayName: string }): ComplaintDto {
    return {
      id: c.id,
      targetType: c.targetType,
      targetId: c.targetId,
      reason: c.reason,
      comment: c.comment,
      status: c.status,
      resolution: c.resolution,
      createdAt: c.createdAt.toISOString(),
      ...(reporter ? { reporter } : {}),
    };
  }

  async myComplaints(userId: string) {
    const rows = await this.db.select().from(complaints).where(eq(complaints.reporterId, userId)).orderBy(desc(complaints.createdAt)).limit(100);
    return rows.map((c) => this.presentComplaint(c));
  }
}
