import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { JobsService } from '../../infra/jobs.service';
import { and, count, desc, eq, inArray, ne, notInArray, sql } from 'drizzle-orm';
import type { ListingCard, SavedSearchDto } from '@lotok/shared';
import { DB, type Db } from '../../database/database.module';
import { favorites, listingStatsDaily, listings, recentViews, savedSearches, userCategoryInterests, users } from '../../database/schema';
import { Errors } from '../../common/errors';
import { paginate } from '../../common/util';
import { ListingPresenter } from '../listings/listing.presenter';
import { ListingsService } from '../listings/listings.service';
import { SearchService } from '../search/search.service';

@Injectable()
export class EngagementService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly presenter: ListingPresenter,
    private readonly listings: ListingsService,
    private readonly search: SearchService,
    private readonly jobs: JobsService,
  ) {}

  onModuleInit() {
    this.jobs.register('stats.decay-interests', () => this.decayInterests());
  }

  /* ------------------------------ избранное ------------------------------ */

  async addFavorite(userId: string, listingId: string) {
    const row = await this.listings.getRow(listingId);
    if (row.status !== 'active') throw Errors.notFound('Объявление');
    await this.db.transaction(async (tx) => {
      const inserted = await tx.insert(favorites).values({ userId, listingId }).onConflictDoNothing().returning();
      if (!inserted.length) return;
      await tx.update(listings).set({ favoritesCount: sql`${listings.favoritesCount} + 1` }).where(eq(listings.id, listingId));
      const day = new Date().toISOString().slice(0, 10);
      await tx
        .insert(listingStatsDaily)
        .values({ listingId, day, favorites: 1 })
        .onConflictDoUpdate({ target: [listingStatsDaily.listingId, listingStatsDaily.day], set: { favorites: sql`${listingStatsDaily.favorites} + 1` } });
    });
    await this.listings.bumpInterest(userId, row.categoryId, 3);
  }

  async removeFavorite(userId: string, listingId: string) {
    await this.db.transaction(async (tx) => {
      const deleted = await tx
        .delete(favorites)
        .where(and(eq(favorites.userId, userId), eq(favorites.listingId, listingId)))
        .returning();
      if (deleted.length) {
        await tx
          .update(listings)
          .set({ favoritesCount: sql`greatest(${listings.favoritesCount} - 1, 0)` })
          .where(eq(listings.id, listingId));
      }
    });
  }

  async listFavorites(userId: string, page: number, limit: number) {
    const { offset } = paginate(page, limit);
    const cond = and(eq(favorites.userId, userId), ne(listings.status, 'deleted'));
    const [rows, [{ total }]] = await Promise.all([
      this.db
        .select({ l: listings })
        .from(favorites)
        .innerJoin(listings, eq(listings.id, favorites.listingId))
        .where(cond)
        .orderBy(desc(favorites.createdAt))
        .limit(limit)
        .offset(offset),
      this.db.select({ total: count() }).from(favorites).innerJoin(listings, eq(listings.id, favorites.listingId)).where(cond),
    ]);
    return { items: await this.presenter.cards(rows.map((r) => r.l), userId), total, page, limit };
  }

  async favoriteIds(userId: string) {
    const rows = await this.db.select({ id: favorites.listingId }).from(favorites).where(eq(favorites.userId, userId));
    return rows.map((r) => r.id);
  }

  /* ------------------------------ сохранённые поиски ------------------------------ */

  async listSaved(userId: string): Promise<SavedSearchDto[]> {
    const rows = await this.db.select().from(savedSearches).where(eq(savedSearches.userId, userId)).orderBy(desc(savedSearches.createdAt));
    const counts = await this.search.countNew(userId);
    return rows.map((s) => ({ id: s.id, name: s.name, query: s.query, notify: s.notify, newCount: counts[s.id] ?? 0, createdAt: s.createdAt.toISOString() }));
  }

  async createSaved(userId: string, input: { name: string; query: Record<string, unknown>; notify: boolean }) {
    const [{ n }] = await this.db.select({ n: count() }).from(savedSearches).where(eq(savedSearches.userId, userId));
    if (n >= 50) throw Errors.conflict('saved_search_limit', 'Можно сохранить не более 50 поисков');
    const [row] = await this.db.insert(savedSearches).values({ userId, ...input }).returning();
    return { id: row.id, name: row.name, query: row.query, notify: row.notify, newCount: 0, createdAt: row.createdAt.toISOString() };
  }

  async updateSaved(userId: string, id: string, patch: { name?: string; notify?: boolean; viewed?: boolean }) {
    const set: Partial<typeof savedSearches.$inferInsert> = {};
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.notify !== undefined) set.notify = patch.notify;
    if (patch.viewed) set.lastViewedAt = new Date();
    const [row] = await this.db
      .update(savedSearches)
      .set(set)
      .where(and(eq(savedSearches.id, id), eq(savedSearches.userId, userId)))
      .returning();
    if (!row) throw Errors.notFound('Поиск');
    return row;
  }

  async deleteSaved(userId: string, id: string) {
    const r = await this.db
      .delete(savedSearches)
      .where(and(eq(savedSearches.id, id), eq(savedSearches.userId, userId)))
      .returning();
    if (!r.length) throw Errors.notFound('Поиск');
  }

  /* ------------------------------ рекомендации ------------------------------ */

  /**
   * Детерминированные рекомендации (не ML):
   * 1) топ-3 категории по весу интересов (просмотр +1, избранное +3, контакт +5; затухание ×0.9 в сутки),
   * 2) свежие активные объявления этих категорий в городе пользователя, без своих и уже просмотренных,
   * 3) добор популярными объявлениями города за 7 дней (по избранному и просмотрам).
   * Сырые события не хранятся — только агрегированные веса; пользователь может их очистить.
   */
  async recommendations(userId: string | null, cityId: number | null, limit = 24): Promise<{ items: ListingCard[]; strategy: string }> {
    let city = cityId;
    let catIds: number[] = [];
    let exclude: string[] = [];
    if (userId) {
      const [u] = await this.db.select({ cityId: users.cityId }).from(users).where(eq(users.id, userId));
      city ??= u?.cityId ?? null;
      const interests = await this.db
        .select({ categoryId: userCategoryInterests.categoryId })
        .from(userCategoryInterests)
        .where(eq(userCategoryInterests.userId, userId))
        .orderBy(desc(userCategoryInterests.score))
        .limit(3);
      catIds = interests.map((i) => i.categoryId);
      const viewed = await this.db
        .select({ id: recentViews.listingId })
        .from(recentViews)
        .where(eq(recentViews.userId, userId))
        .orderBy(desc(recentViews.viewedAt))
        .limit(200);
      exclude = viewed.map((v) => v.id);
    }
    const picked: (typeof listings.$inferSelect)[] = [];
    const baseCond = (extra: ReturnType<typeof and>[]) =>
      and(
        eq(listings.status, 'active'),
        ...(userId ? [ne(listings.userId, userId)] : []),
        ...(exclude.length ? [notInArray(listings.id, exclude)] : []),
        ...extra,
      );
    if (catIds.length) {
      const rows = await this.db
        .select()
        .from(listings)
        .where(baseCond([inArray(listings.categoryId, catIds), ...(city ? [eq(listings.cityId, city)] : [])]))
        .orderBy(desc(listings.bumpedAt))
        .limit(limit);
      picked.push(...rows);
    }
    if (picked.length < limit) {
      const have = picked.map((p) => p.id);
      const rows = await this.db
        .select()
        .from(listings)
        .where(baseCond([...(city ? [eq(listings.cityId, city)] : []), ...(have.length ? [notInArray(listings.id, have)] : [])]))
        .orderBy(desc(sql`${listings.favoritesCount} * 3 + ${listings.viewsCount} / 10.0 + extract(epoch from ${listings.bumpedAt}) / 86400.0`))
        .limit(limit - picked.length);
      picked.push(...rows);
    }
    return { items: await this.presenter.cards(picked, userId), strategy: catIds.length ? 'interests' : 'popular' };
  }

  async recentlyViewed(userId: string, limit = 20) {
    const rows = await this.db
      .select({ l: listings })
      .from(recentViews)
      .innerJoin(listings, eq(listings.id, recentViews.listingId))
      .where(and(eq(recentViews.userId, userId), eq(listings.status, 'active')))
      .orderBy(desc(recentViews.viewedAt))
      .limit(limit);
    return this.presenter.cards(rows.map((r) => r.l), userId);
  }

  async clearHistory(userId: string) {
    await this.db.delete(recentViews).where(eq(recentViews.userId, userId));
    await this.db.delete(userCategoryInterests).where(eq(userCategoryInterests.userId, userId));
  }

  /** Затухание интересов (ежедневно): старые предпочтения постепенно теряют вес. */
  async decayInterests() {
    await this.db.update(userCategoryInterests).set({ score: sql`${userCategoryInterests.score} * 0.9` });
    await this.db.delete(userCategoryInterests).where(sql`${userCategoryInterests.score} < 0.5`);
  }
}
