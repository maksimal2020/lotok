import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { and, asc, eq, gt, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import Redis from 'ioredis';
import type { SearchQuery, SearchResult, Suggestion } from '@lotok/shared';
import { DB, type Db } from '../../database/database.module';
import { attributes, listingAttributeValues, listingMedia, listingPromotions, listings, media, savedSearches, categories } from '../../database/schema';
import { REDIS } from '../../infra/redis.module';
import { JobsService } from '../../infra/jobs.service';
import { CategoriesService } from '../catalog/categories.service';
import { RegionsService } from '../catalog/regions.service';
import { ListingPresenter } from '../listings/listing.presenter';
import { NotificationsService } from '../notifications/notifications.service';
import { Errors } from '../../common/errors';
import { SEARCH_ENGINE, type AttrFilter, type ListingSearchDoc, type ResolvedQuery, type SearchEngine } from './search.types';

@Injectable()
export class SearchService implements OnModuleInit {
  private readonly logger = new Logger('Search');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(SEARCH_ENGINE) readonly engine: SearchEngine,
    private readonly categories: CategoriesService,
    private readonly regions: RegionsService,
    private readonly presenter: ListingPresenter,
    private readonly jobs: JobsService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    this.jobs.register('search.index', (d: { listingId: string }) => this.indexListing(d.listingId));
    this.jobs.register('search.remove', (d: { listingId: string }) => this.engine.remove(d.listingId));
    this.jobs.register('search.reindex-stale', () => this.reindexStale());
    this.jobs.register('notify.saved-searches', () => this.checkSavedSearches());
  }

  private async attributeMap() {
    const c = await this.redis.get('catalog:attrmap');
    if (c) return JSON.parse(c) as Record<string, { id: number; type: string }>;
    const rows = await this.db.select({ id: attributes.id, key: attributes.key, type: attributes.type }).from(attributes);
    const map = Object.fromEntries(rows.map((r) => [r.key, { id: r.id, type: r.type }]));
    await this.redis.set('catalog:attrmap', JSON.stringify(map), 'EX', 120);
    return map;
  }

  /** Перевод публичного запроса в разрешённый: дерево категорий, регионы, характеристики. */
  async resolve(q: SearchQuery, extra: Partial<ResolvedQuery> = {}): Promise<ResolvedQuery> {
    const attrMap = await this.attributeMap();
    const attrs: AttrFilter[] = [];
    const grouped = new Map<string, { values?: string; min?: string; max?: string }>();
    for (const [k, v] of Object.entries(q.attrs ?? {})) {
      const [key, mod] = k.split('.');
      const g = grouped.get(key) ?? {};
      if (mod === 'min') g.min = v;
      else if (mod === 'max') g.max = v;
      else g.values = v;
      grouped.set(key, g);
    }
    for (const [key, g] of grouped) {
      const def = attrMap[key];
      if (!def) continue;
      if (['integer', 'decimal', 'year'].includes(def.type)) {
        const min = g.min !== undefined && g.min !== '' ? Number(g.min) : undefined;
        const max = g.max !== undefined && g.max !== '' ? Number(g.max) : undefined;
        if ((min !== undefined && Number.isFinite(min)) || (max !== undefined && Number.isFinite(max))) {
          attrs.push({ attributeId: def.id, key, kind: 'range', min: Number.isFinite(min) ? min : undefined, max: Number.isFinite(max) ? max : undefined });
        }
      } else if (def.type === 'boolean') {
        if (g.values === 'true' || g.values === 'false') attrs.push({ attributeId: def.id, key, kind: 'bool', bool: g.values === 'true' });
      } else if (g.values) {
        attrs.push({ attributeId: def.id, key, kind: 'terms', values: g.values.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 50) });
      }
    }
    let bbox: ResolvedQuery['bbox'];
    if (q.bbox) {
      const [south, west, north, east] = q.bbox.split(',').map(Number);
      bbox = { south, west, north, east };
    }
    let facetAttributes: ResolvedQuery['facetAttributes'];
    if (q.categoryId) {
      const defs = await this.categories.attributesFor(q.categoryId).catch(() => []);
      facetAttributes = defs.filter((d) => d.isFilterable && (d.type === 'enum' || d.type === 'multi_enum')).slice(0, 6).map((d) => ({ key: d.key, attributeId: d.id }));
    }
    return {
      q: q.q || undefined,
      categoryIds: q.categoryId ? await this.categories.descendantIds(q.categoryId) : undefined,
      cityIds: q.cityId && !q.lat ? await this.regions.descendantIds(q.cityId) : undefined,
      priceMin: q.priceMin,
      priceMax: q.priceMax,
      condition: q.condition,
      delivery: q.delivery,
      withPhoto: q.withPhoto,
      sellerId: q.sellerId,
      geo: q.lat !== undefined && q.lng !== undefined ? { lat: q.lat, lng: q.lng, radiusKm: q.radiusKm ?? 10 } : undefined,
      bbox,
      attrs,
      sort: q.sort === 'distance' && q.lat === undefined ? 'date_desc' : q.sort,
      page: q.page,
      limit: q.limit,
      facetAttributes,
      ...extra,
    };
  }

  /**
   * Поиск. Органическая выдача и платный премиум-блок формируются раздельно:
   * премиум-объявления показываются в отдельном помеченном блоке (не более 3, ротация по часу)
   * и не влияют на порядок органических результатов.
   */
  async search(q: SearchQuery, viewerId: string | null): Promise<SearchResult> {
    const rq = await this.resolve(q);
    let result;
    try {
      result = await this.engine.search(rq);
    } catch (e) {
      this.logger.error({ err: e }, 'Search engine failure');
      throw Errors.unprocessable('search_unavailable', 'Поиск временно недоступен, попробуйте позже');
    }
    let premium: SearchResult['premium'] = [];
    if (rq.page === 1 && rq.sort !== 'price_asc' && rq.sort !== 'price_desc') {
      const p = await this.engine.search({ ...rq, premiumOnly: true, page: 1, limit: 12, sort: 'date_desc', facetAttributes: [] }).catch(() => null);
      if (p?.ids.length) {
        const hour = Math.floor(Date.now() / 3_600_000);
        const rotated = p.ids.map((id, i) => ({ id, k: (i + hour) % p.ids.length })).sort((a, b) => a.k - b.k).slice(0, 3).map((x) => x.id);
        premium = await this.presenter.cardsByIds(rotated, viewerId);
      }
    }
    const items = await this.presenter.cardsByIds(
      result.ids,
      viewerId,
      Object.fromEntries(Object.entries(result.distances).map(([id, d]) => [id, { distanceKm: d }])),
    );
    return { items, premium, total: result.total, page: rq.page, limit: rq.limit, engine: this.engine.name, facets: result.facets };
  }

  async suggest(prefix: string, limit = 8): Promise<Suggestion[]> {
    const p = prefix.trim().slice(0, 100);
    if (p.length < 2) return [];
    const [titles, cats] = await Promise.all([
      this.engine.suggest(p, limit).catch(() => [] as string[]),
      this.db
        .select({ id: categories.id, name: categories.name })
        .from(categories)
        .where(and(eq(categories.isActive, true), sql`${categories.name} ILIKE ${`%${p.replace(/[\\%_]/g, '\\$&')}%`}`))
        .limit(3),
    ]);
    return [
      ...cats.map((c) => ({ text: c.name.toLowerCase(), categoryId: c.id, categoryName: c.name })),
      ...titles.map((t) => ({ text: t, categoryId: null, categoryName: null })),
    ].slice(0, limit);
  }

  async mapPoints(q: SearchQuery) {
    const rq = await this.resolve(q);
    return this.engine.mapPoints(rq, 500);
  }

  /* ----------------------------- индексация ----------------------------- */

  async buildDoc(listingId: string): Promise<ListingSearchDoc | null> {
    const [l] = await this.db.select().from(listings).where(eq(listings.id, listingId));
    if (!l || l.status !== 'active') return null;
    const [path, regionsAll, attrRows, photo, premium] = await Promise.all([
      this.categories.path(l.categoryId),
      this.regions.all(),
      this.db
        .select({ key: attributes.key, type: attributes.type, t: listingAttributeValues.valueText, n: listingAttributeValues.valueNumber, b: listingAttributeValues.valueBool })
        .from(listingAttributeValues)
        .innerJoin(attributes, eq(attributes.id, listingAttributeValues.attributeId))
        .where(eq(listingAttributeValues.listingId, listingId)),
      this.db
        .select({ id: listingMedia.mediaId })
        .from(listingMedia)
        .innerJoin(media, eq(media.id, listingMedia.mediaId))
        .where(and(eq(listingMedia.listingId, listingId), eq(media.status, 'ready')))
        .limit(1),
      this.db
        .select({ endsAt: listingPromotions.endsAt })
        .from(listingPromotions)
        .where(and(eq(listingPromotions.listingId, listingId), eq(listingPromotions.type, 'premium'), lte(listingPromotions.startsAt, new Date()), gt(listingPromotions.endsAt, new Date())))
        .orderBy(asc(listingPromotions.endsAt)),
    ]);
    const regionPath: number[] = [];
    let cur = regionsAll.find((r) => r.id === l.cityId);
    while (cur) {
      regionPath.unshift(cur.id);
      cur = cur.parentId ? regionsAll.find((r) => r.id === cur!.parentId) : undefined;
    }
    const attrs: Record<string, string[]> = {};
    const attrsNum: Record<string, number> = {};
    const attrsBool: Record<string, boolean> = {};
    for (const a of attrRows) {
      if (a.n !== null) attrsNum[a.key] = a.n;
      else if (a.b !== null) attrsBool[a.key] = a.b;
      else if (a.t !== null) (attrs[a.key] ??= []).push(a.t);
    }
    return {
      id: l.id,
      title: l.title,
      description: l.description,
      categoryId: l.categoryId,
      categoryPath: path.map((p) => p.id),
      categoryNames: path.map((p) => p.name),
      cityId: l.cityId,
      regionPath,
      price: l.price,
      priceType: l.priceType,
      condition: l.condition,
      delivery: l.deliveryAvailable,
      hasPhoto: photo.length > 0,
      sellerId: l.userId,
      location: l.lat !== null && l.lng !== null ? { lat: l.lat, lon: l.lng } : null,
      publishedAt: l.publishedAt?.toISOString() ?? null,
      bumpedAt: (l.bumpedAt ?? l.publishedAt)?.toISOString() ?? null,
      attrs,
      attrsNum,
      attrsBool,
      premiumUntil: premium.length ? premium[premium.length - 1].endsAt.toISOString() : null,
    };
  }

  async indexListing(listingId: string) {
    const doc = await this.buildDoc(listingId);
    if (!doc) {
      await this.engine.remove(listingId);
      return;
    }
    await this.engine.index(doc);
    await this.db.update(listings).set({ indexedAt: new Date() }).where(eq(listings.id, listingId));
  }

  /** Сверка: объявления, изменённые после последней индексации (страховка от потерянных заданий). */
  async reindexStale(limit = 2000) {
    if (this.engine.name === 'postgres') return 0;
    const rows = await this.db
      .select({ id: listings.id })
      .from(listings)
      .where(and(eq(listings.status, 'active'), or(isNull(listings.indexedAt), lt(listings.indexedAt, listings.updatedAt))))
      .limit(limit);
    for (const r of rows) await this.indexListing(r.id);
    return rows.length;
  }

  async reindexAll() {
    await this.engine.ensureIndex();
    const rows = await this.db.select({ id: listings.id }).from(listings).where(eq(listings.status, 'active'));
    for (const r of rows) await this.indexListing(r.id);
    return rows.length;
  }

  /* ----------------------------- сохранённые поиски ----------------------------- */

  /** Периодическая проверка подписок: уведомление, если появились новые объявления. */
  async checkSavedSearches() {
    const due = await this.db
      .select()
      .from(savedSearches)
      .where(and(eq(savedSearches.notify, true), lt(savedSearches.lastCheckedAt, new Date(Date.now() - 15 * 60 * 1000))))
      .limit(500);
    let notified = 0;
    for (const s of due) {
      const since = s.lastCheckedAt;
      const rq = await this.resolve({ ...(s.query as SearchQuery), attrs: (s.query as SearchQuery).attrs ?? {}, page: 1, limit: 5, sort: 'date_desc' }, { publishedAfter: since });
      const r = await this.engine.search({ ...rq, facetAttributes: [] }).catch(() => null);
      await this.db.update(savedSearches).set({ lastCheckedAt: new Date() }).where(eq(savedSearches.id, s.id));
      if (r && r.total > 0) {
        notified++;
        await this.notifications.notify(s.userId, {
          type: 'saved_search.new',
          group: 'saved_searches',
          title: `Новые объявления: ${s.name}`,
          body: `По вашей подписке ${r.total} новых объявлений.`,
          data: { savedSearchId: s.id },
        });
      }
    }
    return notified;
  }

  async countNew(userId: string) {
    const rows = await this.db.select().from(savedSearches).where(eq(savedSearches.userId, userId));
    const out: Record<string, number> = {};
    for (const s of rows) {
      const rq = await this.resolve({ ...(s.query as SearchQuery), attrs: (s.query as SearchQuery).attrs ?? {}, page: 1, limit: 1, sort: 'date_desc' }, { publishedAfter: s.lastViewedAt });
      out[s.id] = (await this.engine.search({ ...rq, facetAttributes: [] }).catch(() => ({ total: 0 }))).total;
    }
    return out;
  }

  /** Для тестов и админки: принудительная синхронизация индекса. */
  async ids(ids: string[]) {
    return this.db.select({ id: listings.id }).from(listings).where(inArray(listings.id, ids));
  }
}
