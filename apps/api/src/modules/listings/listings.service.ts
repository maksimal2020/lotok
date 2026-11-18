import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { and, asc, count, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm';
import Redis from 'ioredis';
import {
  EDITABLE_LISTING_STATUSES,
  findListingTransition,
  type CreateListingInput,
  type LifecycleActor,
  type ListingStatus,
  type ListingStats,
  type UpdateListingInput,
} from '@lotok/shared';
import { DB, type Db, type DbOrTx } from '../../database/database.module';
import {
  listingAttributeValues,
  listingMedia,
  listingStatsDaily,
  listingStatusHistory,
  listings,
  media,
  organizationMembers,
  purchases,
  paidServices,
  userSubscriptions,
  users,
  userCategoryInterests,
  recentViews,
} from '../../database/schema';
import { REDIS } from '../../infra/redis.module';
import { JobsService } from '../../infra/jobs.service';
import { SettingsService } from '../../infra/platform.services';
import { track } from '../../infra/metrics';
import { Errors } from '../../common/errors';
import { addDays, paginate, sha256 } from '../../common/util';
import { CategoriesService } from '../catalog/categories.service';
import { RegionsService } from '../catalog/regions.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ListingPresenter, type ListingRow } from './listing.presenter';
import { AutoModerationService } from './auto-moderation.service';

export interface TransitionOptions {
  reason?: string | null;
  actorId?: string | null;
  tx?: DbOrTx;
  skipEffects?: boolean;
}

@Injectable()
export class ListingsService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly categories: CategoriesService,
    private readonly regions: RegionsService,
    private readonly presenter: ListingPresenter,
    private readonly jobs: JobsService,
    private readonly settings: SettingsService,
    private readonly autoModeration: AutoModerationService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    this.jobs.register('listings.expire', () => this.expireListings());
  }

  /* ------------------------------ чтение ------------------------------ */

  async getRow(id: string, tx: DbOrTx = this.db): Promise<ListingRow> {
    const [row] = await tx.select().from(listings).where(eq(listings.id, id));
    if (!row || row.status === 'deleted') throw Errors.notFound('Объявление');
    return row;
  }

  async getOwned(userId: string, id: string, tx: DbOrTx = this.db): Promise<ListingRow> {
    const row = await this.getRow(id, tx);
    // IDOR: чужое объявление неотличимо от несуществующего.
    if (row.userId !== userId) throw Errors.notFound('Объявление');
    return row;
  }

  /** Публичная карточка; владелец и сотрудники видят объявление в любом статусе. */
  async getPublic(id: string, viewer: { id: string; canModerate: boolean } | null) {
    const row = await this.getRow(id);
    const isOwner = viewer?.id === row.userId;
    if (row.status !== 'active' && !isOwner && !viewer?.canModerate) {
      if (row.status === 'sold' || row.status === 'expired' || row.status === 'inactive' || row.status === 'archived') {
        // Снятое объявление показываем с пометкой — для SEO и перешедших по ссылке.
        return this.presenter.detail({ ...row, description: row.description }, viewer?.id ?? null);
      }
      throw Errors.notFound('Объявление');
    }
    return this.presenter.detail(row, viewer?.id ?? null);
  }

  async listMine(userId: string, status: ListingStatus | 'all', page: number, limit: number) {
    const cond = status === 'all' ? and(eq(listings.userId, userId), ne(listings.status, 'deleted')) : and(eq(listings.userId, userId), eq(listings.status, status));
    const { offset } = paginate(page, limit);
    const [rows, [{ total }], counts] = await Promise.all([
      this.db.select().from(listings).where(cond).orderBy(desc(listings.updatedAt)).limit(limit).offset(offset),
      this.db.select({ total: count() }).from(listings).where(cond),
      this.db
        .select({ status: listings.status, n: count() })
        .from(listings)
        .where(and(eq(listings.userId, userId), ne(listings.status, 'deleted')))
        .groupBy(listings.status),
    ]);
    const cards = await this.presenter.cards(rows, userId);
    return {
      items: cards.map((c, i) => ({ ...c, viewsCount: rows[i].viewsCount, favoritesCount: rows[i].favoritesCount, contactsCount: rows[i].contactsCount, rejectionReason: rows[i].rejectionReason, expiresAt: rows[i].expiresAt?.toISOString() ?? null })),
      total,
      page,
      limit,
      counts: Object.fromEntries(counts.map((c) => [c.status, c.n])),
    };
  }

  async listBySeller(sellerId: string, page: number, limit: number, viewerId: string | null) {
    const cond = and(eq(listings.userId, sellerId), eq(listings.status, 'active'));
    const { offset } = paginate(page, limit);
    const [rows, [{ total }]] = await Promise.all([
      this.db.select().from(listings).where(cond).orderBy(desc(listings.bumpedAt)).limit(limit).offset(offset),
      this.db.select({ total: count() }).from(listings).where(cond),
    ]);
    return { items: await this.presenter.cards(rows, viewerId), total, page, limit };
  }

  /* ------------------------------ запись ------------------------------ */

  private async validateCommon(userId: string, input: Partial<CreateListingInput>, categoryId: number, forSubmit: boolean) {
    const category = await this.categories.get(categoryId);
    if (!category.isActive) throw Errors.badRequest('category_inactive', 'Категория недоступна для размещения');
    if (!(await this.categories.isLeaf(categoryId))) throw Errors.badRequest('category_not_leaf', 'Выберите конкретную подкатегорию');
    if (input.cityId !== undefined) {
      const city = await this.regions.get(input.cityId);
      if (city.type !== 'city' && city.type !== 'district') throw Errors.badRequest('invalid_city', 'Укажите город');
    }
    if (input.videoUrl && !category.allowVideo) throw Errors.badRequest('video_not_allowed', 'В этой категории нельзя добавить видео');
    if (input.deliveryAvailable && !category.allowDelivery) throw Errors.badRequest('delivery_not_allowed', 'В этой категории доставка недоступна');
    if (input.mediaIds) {
      if (input.mediaIds.length > category.maxPhotos) throw Errors.badRequest('too_many_photos', `Не больше ${category.maxPhotos} фото`);
      if (new Set(input.mediaIds).size !== input.mediaIds.length) throw Errors.badRequest('duplicate_photos', 'Фотографии повторяются');
      if (input.mediaIds.length) {
        const rows = await this.db.select().from(media).where(inArray(media.id, input.mediaIds));
        const bad = input.mediaIds.filter((id) => {
          const m = rows.find((r) => r.id === id);
          return !m || m.ownerId !== userId || m.kind !== 'image' || m.purpose !== 'listing' || m.status === 'failed' || m.status === 'rejected';
        });
        if (bad.length) throw Errors.badRequest('invalid_media', 'Некоторые фотографии недоступны', { mediaIds: bad });
      }
    }
    if (input.contactMethods?.includes('phone')) {
      const [u] = await this.db.select({ phoneVerifiedAt: users.phoneVerifiedAt }).from(users).where(eq(users.id, userId));
      if (!u?.phoneVerifiedAt) throw Errors.badRequest('phone_not_verified', 'Чтобы показывать телефон, подтвердите номер в профиле');
    }
    if (input.organizationId) {
      const [m] = await this.db
        .select()
        .from(organizationMembers)
        .where(and(eq(organizationMembers.organizationId, input.organizationId), eq(organizationMembers.userId, userId)));
      if (!m) throw Errors.forbidden('Вы не состоите в этой организации');
    }
    if (forSubmit) {
      if ((input.priceType === 'fixed' || input.priceType === 'negotiable') && (input.price === null || input.price === undefined)) {
        throw Errors.badRequest('validation_error', 'Укажите цену', [{ path: 'price', message: 'Укажите цену' }]);
      }
    }
    return category;
  }

  private normalizePrice<T extends { priceType?: string; price?: number | null }>(input: T): T {
    if (input.priceType === 'free') return { ...input, price: 0 };
    if (input.priceType === 'on_request') return { ...input, price: null };
    return input;
  }

  async create(userId: string, raw: CreateListingInput) {
    const input = this.normalizePrice(raw);
    await this.validateCommon(userId, input, input.categoryId, false);
    const attrs = await this.categories.validateAttributes(input.categoryId, input.attributes, false);
    const id = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(listings)
        .values({
          userId,
          organizationId: input.organizationId ?? null,
          categoryId: input.categoryId,
          title: input.title,
          description: input.description,
          price: input.price ?? null,
          priceType: input.priceType,
          condition: input.condition ?? null,
          cityId: input.cityId,
          address: input.address ?? null,
          lat: input.lat ?? null,
          lng: input.lng ?? null,
          contactMethods: input.contactMethods,
          deliveryAvailable: input.deliveryAvailable,
          quantity: input.quantity,
          videoUrl: input.videoUrl ?? null,
          status: 'draft',
        })
        .returning({ id: listings.id });
      await this.replaceAttributes(tx, row.id, attrs);
      await this.replaceMedia(tx, row.id, input.mediaIds);
      await tx.insert(listingStatusHistory).values({ listingId: row.id, fromStatus: null, toStatus: 'draft', action: 'create', actorId: userId, actorType: 'owner' });
      return row.id;
    });
    track('listing_created');
    return this.presenter.detail(await this.getRow(id), userId);
  }

  async update(userId: string, id: string, raw: UpdateListingInput) {
    const input = this.normalizePrice(raw);
    const current = await this.getOwned(userId, id);
    if (!EDITABLE_LISTING_STATUSES.includes(current.status)) throw Errors.conflict('not_editable', 'Объявление в этом статусе нельзя редактировать');
    const categoryId = input.categoryId ?? current.categoryId;
    if (current.status !== 'draft' && input.categoryId && input.categoryId !== current.categoryId) {
      const [a, b] = await Promise.all([this.categories.get(current.categoryId), this.categories.get(input.categoryId)]);
      if (a.vertical !== b.vertical) throw Errors.badRequest('category_change_forbidden', 'Нельзя перенести опубликованное объявление в другой раздел');
    }
    await this.validateCommon(userId, { ...input, cityId: input.cityId }, categoryId, false);
    const attrs = input.attributes !== undefined || input.categoryId !== undefined
      ? await this.categories.validateAttributes(categoryId, input.attributes ?? (await this.currentAttributes(id, categoryId)), current.status !== 'draft')
      : null;

    const significant =
      (input.title !== undefined && input.title !== current.title) ||
      (input.description !== undefined && input.description !== current.description) ||
      (input.categoryId !== undefined && input.categoryId !== current.categoryId) ||
      input.mediaIds !== undefined;

    await this.db.transaction(async (tx) => {
      const { version, attributes: _a, mediaIds: _m, ...fields } = input;
      const [updated] = await tx
        .update(listings)
        .set({ ...fields, version: sql`${listings.version} + 1`, updatedAt: new Date() })
        .where(and(eq(listings.id, id), eq(listings.version, version)))
        .returning({ id: listings.id });
      if (!updated) throw Errors.versionConflict();
      if (attrs) await this.replaceAttributes(tx, id, attrs);
      if (input.mediaIds) await this.replaceMedia(tx, id, input.mediaIds);
      // Существенные изменения опубликованного объявления отправляют его на повторную проверку.
      if (current.status === 'active' && significant) {
        await this.transition(id, 'moderation', 'owner', { actorId: userId, tx, reason: 'edited', skipEffects: true });
      }
    });
    const after = await this.getRow(id);
    if (after.status === 'moderation' && current.status === 'active') await this.runAutoModeration(after);
    else if (after.status === 'active') await this.jobs.enqueue('search.index', { listingId: id });
    return this.presenter.detail(await this.getRow(id), userId);
  }

  private async currentAttributes(listingId: string, categoryId: number) {
    const rows = await this.db.select().from(listingAttributeValues).where(eq(listingAttributeValues.listingId, listingId));
    const defs = await this.categories.attributesFor(categoryId);
    const out: Record<string, string | number | boolean | string[]> = {};
    for (const d of defs) {
      const mine = rows.filter((r) => r.attributeId === d.id);
      if (!mine.length) continue;
      if (d.type === 'multi_enum') out[d.key] = mine.map((m) => m.valueText!);
      else if (d.type === 'boolean') out[d.key] = !!mine[0].valueBool;
      else if (mine[0].valueNumber !== null) out[d.key] = mine[0].valueNumber;
      else out[d.key] = mine[0].valueText ?? '';
    }
    return out;
  }

  private async replaceAttributes(tx: DbOrTx, listingId: string, attrs: Awaited<ReturnType<CategoriesService['validateAttributes']>>) {
    await tx.delete(listingAttributeValues).where(eq(listingAttributeValues.listingId, listingId));
    if (attrs.length) await tx.insert(listingAttributeValues).values(attrs.map((a) => ({ ...a, listingId })));
  }

  private async replaceMedia(tx: DbOrTx, listingId: string, mediaIds: string[]) {
    await tx.delete(listingMedia).where(eq(listingMedia.listingId, listingId));
    if (mediaIds.length) await tx.insert(listingMedia).values(mediaIds.map((mediaId, position) => ({ listingId, mediaId, position })));
  }

  /* ------------------------------ жизненный цикл ------------------------------ */

  /**
   * Единственная точка смены статуса. Строка блокируется (SELECT … FOR UPDATE),
   * переход проверяется по машине состояний из @lotok/shared, пишется история.
   */
  async transition(id: string, to: ListingStatus, actor: LifecycleActor, opts: TransitionOptions = {}) {
    const run = async (tx: DbOrTx) => {
      const [row] = await tx.select().from(listings).where(eq(listings.id, id)).for('update');
      if (!row) throw Errors.notFound('Объявление');
      const t = findListingTransition(row.status, to, actor);
      if (!t) throw Errors.invalidTransition(row.status, to);
      const now = new Date();
      const patch: Partial<typeof listings.$inferInsert> = { status: to, updatedAt: now };
      if (to === 'active') {
        const ttl = await this.settings.get('listings.ttl_days');
        patch.publishedAt = row.publishedAt ?? now;
        patch.bumpedAt = now;
        patch.expiresAt = addDays(now, ttl);
        patch.rejectionReason = null;
        patch.moderatedAt = now;
        patch.moderatedBy = actor === 'moderator' ? (opts.actorId ?? null) : null;
      }
      if (to === 'rejected' || to === 'blocked') {
        patch.rejectionReason = opts.reason ?? null;
        patch.moderatedAt = now;
        patch.moderatedBy = actor === 'moderator' ? (opts.actorId ?? null) : null;
      }
      if (to === 'sold') patch.soldAt = now;
      if (to === 'active') patch.quotaPurchaseId = null;
      if (to === 'deleted') patch.deletedAt = now;
      await tx.update(listings).set(patch).where(eq(listings.id, id));
      if (to === 'rejected' || to === 'blocked') await this.restoreQuota(tx, id);
      await tx.insert(listingStatusHistory).values({
        listingId: id,
        fromStatus: row.status,
        toStatus: to,
        action: t.action,
        actorId: opts.actorId ?? null,
        actorType: actor,
        reason: opts.reason ?? null,
      });
      return { from: row.status, row };
    };
    const result = opts.tx ? await run(opts.tx) : await this.db.transaction(run);
    if (!opts.skipEffects) await this.afterTransition(id, result.from, to, result.row.userId, opts.reason ?? null);
    return result;
  }

  private async afterTransition(id: string, from: ListingStatus, to: ListingStatus, ownerId: string, reason: string | null) {
    if (to === 'active') await this.jobs.enqueue('search.index', { listingId: id });
    else if (from === 'active') await this.jobs.enqueue('search.remove', { listingId: id });
    const [l] = await this.db.select({ title: listings.title }).from(listings).where(eq(listings.id, id));
    const title = l?.title ?? '';
    if (to === 'active' && from === 'moderation') {
      await this.notifications.notify(ownerId, { type: 'listing.approved', group: 'listings', title: 'Объявление опубликовано', body: `«${title}» прошло проверку и опубликовано.`, data: { listingId: id } });
    } else if (to === 'rejected') {
      await this.notifications.notify(ownerId, { type: 'listing.rejected', group: 'listings', title: 'Объявление отклонено', body: `«${title}»: ${reason ?? 'не соответствует правилам'}. Исправьте и отправьте снова.`, data: { listingId: id } });
    } else if (to === 'blocked') {
      await this.notifications.notify(ownerId, { type: 'listing.blocked', group: 'listings', title: 'Объявление заблокировано', body: `«${title}»: ${reason ?? 'нарушение правил'}.`, data: { listingId: id } });
    } else if (to === 'expired') {
      await this.notifications.notify(ownerId, { type: 'listing.expired', group: 'listings', title: 'Срок размещения истёк', body: `«${title}» снято с публикации. Опубликуйте его снова, если товар актуален.`, data: { listingId: id } });
    }
  }

  /** Отправка на модерацию: полная проверка, учёт лимита бесплатных публикаций, автоматическая модерация. */
  async submit(userId: string, id: string) {
    const row = await this.getOwned(userId, id);
    await this.validateForPublication(userId, row);
    await this.db.transaction(async (tx) => {
      await this.consumeQuota(tx, userId, row);
      await this.transition(id, 'moderation', 'owner', { actorId: userId, tx, skipEffects: true });
    });
    await this.runAutoModeration(await this.getRow(id));
    return this.presenter.detail(await this.getRow(id), userId);
  }

  async republish(userId: string, id: string) {
    const row = await this.getOwned(userId, id);
    await this.validateForPublication(userId, row);
    await this.db.transaction(async (tx) => {
      await this.consumeQuota(tx, userId, row);
      await this.transition(id, 'moderation', 'owner', { actorId: userId, tx, skipEffects: true });
    });
    await this.runAutoModeration(await this.getRow(id));
    return this.presenter.detail(await this.getRow(id), userId);
  }

  private async validateForPublication(userId: string, row: ListingRow) {
    const [u] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!u.emailVerifiedAt && !u.phoneVerifiedAt) {
      throw Errors.forbidden('Подтвердите email или телефон, чтобы публиковать объявления', 'contact_not_verified');
    }
    await this.validateCommon(userId, { priceType: row.priceType, price: row.price, contactMethods: row.contactMethods as never }, row.categoryId, true);
    await this.categories.validateAttributes(row.categoryId, await this.currentAttributes(row.id, row.categoryId), true);
  }

  /**
   * Лимит бесплатных публикаций за 30 дней в категории (настраивается в админке).
   * Сверх лимита списывается оплаченная публикация (listing_slot / listing_package).
   * PRO-подписка снимает лимит.
   */
  private async consumeQuota(tx: DbOrTx, userId: string, row: ListingRow) {
    const limitCat = await this.categories.limitCategory(row.categoryId);
    const limit = limitCat?.freeListingLimit ?? (await this.settings.get('listings.default_free_limit'));
    if (limit === null || limit === undefined) return;
    const [pro] = await tx
      .select({ n: count() })
      .from(userSubscriptions)
      .where(and(eq(userSubscriptions.userId, userId), eq(userSubscriptions.serviceType, 'pro_subscription'), gt(userSubscriptions.endsAt, new Date())));
    if (pro.n > 0) return;
    const scope = await this.categories.descendantIds(limitCat?.id ?? row.categoryId);
    const since = addDays(new Date(), -30);
    const [used] = await tx
      .select({ n: sql<number>`count(distinct ${listingStatusHistory.listingId})::int` })
      .from(listingStatusHistory)
      .innerJoin(listings, eq(listings.id, listingStatusHistory.listingId))
      .where(
        and(
          eq(listings.userId, userId),
          inArray(listings.categoryId, scope),
          eq(listingStatusHistory.toStatus, 'moderation'),
          gte(listingStatusHistory.createdAt, since),
          ne(listings.id, row.id),
        ),
      );
    if (used.n < limit) return;
    // Ищем доступную оплаченную публикацию (FIFO по сроку окончания), блокируя строку от двойного списания.
    const [slot] = await tx
      .select({ id: purchases.id, remaining: purchases.quantityRemaining })
      .from(purchases)
      .innerJoin(paidServices, eq(paidServices.id, purchases.serviceId))
      .where(
        and(
          eq(purchases.userId, userId),
          eq(purchases.status, 'active'),
          inArray(paidServices.type, ['listing_slot', 'listing_package']),
          gt(purchases.quantityRemaining, 0),
          sql`(${purchases.endsAt} IS NULL OR ${purchases.endsAt} > now())`,
          or(isNull(paidServices.categoryId), inArray(paidServices.categoryId, scope)),
        ),
      )
      .orderBy(asc(purchases.endsAt))
      .limit(1)
      .for('update', { of: purchases });
    if (!slot) {
      throw Errors.paymentRequired('listing_limit_exceeded', `Бесплатный лимит публикаций в категории «${limitCat?.name ?? ''}» исчерпан (${limit} за 30 дней). Купите дополнительную публикацию или пакет.`, {
        limit,
        used: used.n,
        categoryId: limitCat?.id ?? row.categoryId,
      });
    }
    const remaining = (slot.remaining ?? 1) - 1;
    await tx
      .update(purchases)
      .set({ quantityRemaining: remaining, status: remaining <= 0 ? 'consumed' : 'active', updatedAt: new Date() })
      .where(eq(purchases.id, slot.id));
    await tx.update(listings).set({ quotaPurchaseId: slot.id }).where(eq(listings.id, row.id));
  }

  /** Возврат списанной публикации, если объявление отклонено модерацией. */
  private async restoreQuota(tx: DbOrTx, listingId: string) {
    const [l] = await tx.select({ q: listings.quotaPurchaseId }).from(listings).where(eq(listings.id, listingId));
    if (!l?.q) return;
    await tx
      .update(purchases)
      .set({ quantityRemaining: sql`coalesce(${purchases.quantityRemaining}, 0) + 1`, status: 'active', updatedAt: new Date() })
      .where(and(eq(purchases.id, l.q), inArray(purchases.status, ['active', 'consumed'])));
    await tx.update(listings).set({ quotaPurchaseId: null }).where(eq(listings.id, listingId));
  }

  async runAutoModeration(row: ListingRow) {
    const result = await this.autoModeration.evaluate(row);
    await this.autoModeration.record(row.id, result);
    if (result.decision === 'approve') await this.transition(row.id, 'active', 'system', { reason: 'auto' });
    else if (result.decision === 'reject') await this.transition(row.id, 'rejected', 'system', { reason: result.reason });
    else await this.db.update(listings).set({ moderationFlags: result.flags }).where(eq(listings.id, row.id));
  }

  async ownerAction(userId: string, id: string, action: 'unpublish' | 'mark_sold' | 'archive' | 'delete') {
    await this.getOwned(userId, id);
    const target: Record<typeof action, ListingStatus> = { unpublish: 'inactive', mark_sold: 'sold', archive: 'archived', delete: 'deleted' };
    await this.transition(id, target[action], 'owner', { actorId: userId });
    if (action === 'delete') return null;
    return this.presenter.detail(await this.getRow(id), userId);
  }

  /** Периодическое задание: снятие объявлений с истёкшим сроком размещения. */
  async expireListings() {
    const rows = await this.db
      .select({ id: listings.id })
      .from(listings)
      .where(and(eq(listings.status, 'active'), isNotNull(listings.expiresAt), lt(listings.expiresAt, new Date())))
      .limit(1000);
    for (const r of rows) await this.transition(r.id, 'expired', 'system').catch(() => undefined);
    return rows.length;
  }

  /* ------------------------------ статистика ------------------------------ */

  /** Просмотр учитывается не чаще раза в 30 минут на зрителя (пользователь или IP+UA). */
  async registerView(id: string, viewer: { userId: string | null; fingerprint: string }) {
    const row = await this.getRow(id);
    if (row.status !== 'active' || row.userId === viewer.userId) return;
    const key = `view:${id}:${viewer.userId ?? sha256(viewer.fingerprint).slice(0, 16)}`;
    const fresh = await this.redis.set(key, '1', 'EX', 1800, 'NX');
    if (fresh !== 'OK') return;
    const day = new Date().toISOString().slice(0, 10);
    await this.db.update(listings).set({ viewsCount: sql`${listings.viewsCount} + 1` }).where(eq(listings.id, id));
    await this.db
      .insert(listingStatsDaily)
      .values({ listingId: id, day, views: 1 })
      .onConflictDoUpdate({ target: [listingStatsDaily.listingId, listingStatsDaily.day], set: { views: sql`${listingStatsDaily.views} + 1` } });
    if (viewer.userId) {
      await this.db
        .insert(recentViews)
        .values({ userId: viewer.userId, listingId: id })
        .onConflictDoUpdate({ target: [recentViews.userId, recentViews.listingId], set: { viewedAt: new Date() } });
      await this.bumpInterest(viewer.userId, row.categoryId, 1);
    }
  }

  async registerContact(id: string, userId: string | null) {
    const day = new Date().toISOString().slice(0, 10);
    await this.db.update(listings).set({ contactsCount: sql`${listings.contactsCount} + 1` }).where(eq(listings.id, id));
    await this.db
      .insert(listingStatsDaily)
      .values({ listingId: id, day, contacts: 1 })
      .onConflictDoUpdate({ target: [listingStatsDaily.listingId, listingStatsDaily.day], set: { contacts: sql`${listingStatsDaily.contacts} + 1` } });
    if (userId) {
      const row = await this.getRow(id);
      await this.bumpInterest(userId, row.categoryId, 5);
    }
  }

  async bumpInterest(userId: string, categoryId: number, weight: number) {
    await this.db
      .insert(userCategoryInterests)
      .values({ userId, categoryId, score: weight })
      .onConflictDoUpdate({
        target: [userCategoryInterests.userId, userCategoryInterests.categoryId],
        set: { score: sql`${userCategoryInterests.score} + ${weight}`, updatedAt: new Date() },
      });
  }

  async revealPhone(id: string, userId: string) {
    const row = await this.getRow(id);
    if (row.status !== 'active') throw Errors.notFound('Объявление');
    if (!(row.contactMethods as string[]).includes('phone')) throw Errors.forbidden('Продавец предпочитает общение в чате', 'phone_hidden');
    const [u] = await this.db.select({ phone: users.phone, verified: users.phoneVerifiedAt }).from(users).where(eq(users.id, row.userId));
    if (!u?.phone || !u.verified) throw Errors.forbidden('Телефон продавца недоступен', 'phone_hidden');
    if (row.userId !== userId) await this.registerContact(id, userId);
    return { phone: u.phone };
  }

  async stats(userId: string, id: string, extended: boolean): Promise<ListingStats> {
    const row = await this.getOwned(userId, id);
    const days = extended ? 90 : 14;
    const daily = await this.db
      .select()
      .from(listingStatsDaily)
      .where(and(eq(listingStatsDaily.listingId, id), gte(listingStatsDaily.day, addDays(new Date(), -days).toISOString().slice(0, 10))))
      .orderBy(asc(listingStatsDaily.day));
    return {
      listingId: id,
      totals: { views: row.viewsCount, contacts: row.contactsCount, favorites: row.favoritesCount },
      daily: daily.map((d) => ({ date: d.day, views: d.views, contacts: d.contacts, favorites: d.favorites })),
      extended,
    };
  }

  async history(userId: string, id: string) {
    await this.getOwned(userId, id);
    return this.db.select().from(listingStatusHistory).where(eq(listingStatusHistory.listingId, id)).orderBy(asc(listingStatusHistory.createdAt));
  }
}
