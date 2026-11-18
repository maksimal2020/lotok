import { sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../database/database.module';
import { expandQuery } from './synonyms';
import type { EngineResult, ListingSearchDoc, ResolvedQuery, SearchEngine } from './search.types';

const inList = (col: SQL, values: Array<string | number>) => sql`${col} IN (${sql.join(values.map((v) => sql`${v}`), sql`, `)})`;

const DIST = (lat: number, lng: number) =>
  sql`(6371 * 2 * asin(sqrt(power(sin(radians(l.lat - ${lat}) / 2), 2) + cos(radians(${lat})) * cos(radians(l.lat)) * power(sin(radians(l.lng - ${lng}) / 2), 2))))`;

/**
 * Поиск на PostgreSQL: полнотекстовый индекс (russian) + триграммы pg_trgm для опечаток.
 * Используется как резервный движок и в тестах; источник данных — сами таблицы, индексация не нужна.
 */
export class PostgresSearchEngine implements SearchEngine {
  readonly name = 'postgres' as const;
  constructor(private readonly db: Db) {}

  private where(q: ResolvedQuery): SQL[] {
    const w: SQL[] = [sql`l.status = 'active'`];
    if (q.q) {
      const variants = expandQuery(q.q);
      w.push(
        sql`(${sql.join(
          variants.map((v) => sql`l.search_tsv @@ websearch_to_tsquery('russian', ${v}) OR word_similarity(${v}, l.title) > 0.45`),
          sql` OR `,
        )})`,
      );
    }
    if (q.categoryIds?.length) w.push(inList(sql`l.category_id`, q.categoryIds));
    if (q.cityIds?.length) w.push(inList(sql`l.city_id`, q.cityIds));
    if (q.priceMin !== undefined) w.push(sql`l.price >= ${q.priceMin}`);
    if (q.priceMax !== undefined) w.push(sql`l.price <= ${q.priceMax}`);
    if (q.condition) w.push(sql`l.condition = ${q.condition}`);
    if (q.delivery) w.push(sql`l.delivery_available = true`);
    if (q.sellerId) w.push(sql`l.user_id = ${q.sellerId}`);
    if (q.publishedAfter) w.push(sql`l.published_at > ${q.publishedAfter.toISOString()}`);
    if (q.excludeIds?.length) w.push(sql`NOT ${inList(sql`l.id`, q.excludeIds)}`);
    if (q.withPhoto) w.push(sql`EXISTS (SELECT 1 FROM listing_media lm JOIN media m ON m.id = lm.media_id WHERE lm.listing_id = l.id AND m.status = 'ready')`);
    if (q.geo) {
      // Грубый bbox для использования индекса + точная дистанция.
      const dLat = q.geo.radiusKm / 111;
      const dLng = q.geo.radiusKm / (111 * Math.max(0.1, Math.cos((q.geo.lat * Math.PI) / 180)));
      w.push(sql`l.lat BETWEEN ${q.geo.lat - dLat} AND ${q.geo.lat + dLat} AND l.lng BETWEEN ${q.geo.lng - dLng} AND ${q.geo.lng + dLng}`);
      w.push(sql`${DIST(q.geo.lat, q.geo.lng)} <= ${q.geo.radiusKm}`);
    }
    if (q.bbox) w.push(sql`l.lat BETWEEN ${q.bbox.south} AND ${q.bbox.north} AND l.lng BETWEEN ${q.bbox.west} AND ${q.bbox.east}`);
    if (q.premiumOnly) {
      w.push(sql`EXISTS (SELECT 1 FROM listing_promotions p WHERE p.listing_id = l.id AND p.type = 'premium' AND p.starts_at <= now() AND p.ends_at > now())`);
    }
    for (const a of q.attrs) {
      if (a.kind === 'terms' && a.values?.length) {
        w.push(
          sql`EXISTS (SELECT 1 FROM listing_attribute_values v WHERE v.listing_id = l.id AND v.attribute_id = ${a.attributeId} AND v.value_text IN (${sql.join(
            a.values.map((v) => sql`${v}`),
            sql`, `,
          )}))`,
        );
      } else if (a.kind === 'range') {
        const parts: SQL[] = [sql`v.listing_id = l.id`, sql`v.attribute_id = ${a.attributeId}`];
        if (a.min !== undefined) parts.push(sql`v.value_number >= ${a.min}`);
        if (a.max !== undefined) parts.push(sql`v.value_number <= ${a.max}`);
        w.push(sql`EXISTS (SELECT 1 FROM listing_attribute_values v WHERE ${sql.join(parts, sql` AND `)})`);
      } else if (a.kind === 'bool') {
        w.push(sql`EXISTS (SELECT 1 FROM listing_attribute_values v WHERE v.listing_id = l.id AND v.attribute_id = ${a.attributeId} AND v.value_bool = ${!!a.bool})`);
      }
    }
    return w;
  }

  async search(q: ResolvedQuery): Promise<EngineResult> {
    const where = sql.join(this.where(q), sql` AND `);
    const rank = q.q
      ? sql`(ts_rank_cd(l.search_tsv, websearch_to_tsquery('russian', ${q.q})) + word_similarity(${q.q}, l.title))`
      : sql`0`;
    const dist = q.geo ? DIST(q.geo.lat, q.geo.lng) : sql`NULL::float`;
    let order: SQL;
    switch (q.sort) {
      case 'price_asc':
        order = sql`l.price ASC NULLS LAST, l.bumped_at DESC`;
        break;
      case 'price_desc':
        order = sql`l.price DESC NULLS LAST, l.bumped_at DESC`;
        break;
      case 'date_desc':
        order = sql`l.bumped_at DESC, l.id`;
        break;
      case 'distance':
        order = q.geo ? sql`dist ASC, l.bumped_at DESC` : sql`l.bumped_at DESC`;
        break;
      default:
        // Органическая выдача: релевантность, затем свежесть. Платное продвижение здесь не учитывается.
        order = q.q ? sql`rank DESC, l.bumped_at DESC` : sql`l.bumped_at DESC, l.id`;
    }
    const offset = (q.page - 1) * q.limit;
    const rows = await this.db.execute<{ id: string; dist: number | null; total: string }>(
      sql`SELECT l.id, ${dist} AS dist, ${rank} AS rank, count(*) OVER() AS total FROM listings l WHERE ${where} ORDER BY ${order} LIMIT ${q.limit} OFFSET ${offset}`,
    );
    let total = rows.rows.length ? Number(rows.rows[0].total) : 0;
    if (!rows.rows.length && offset > 0) {
      const c = await this.db.execute<{ n: string }>(sql`SELECT count(*) AS n FROM listings l WHERE ${where}`);
      total = Number(c.rows[0].n);
    }
    const facets: EngineResult['facets'] = {};
    if (!q.premiumOnly) {
      const cat = await this.db.execute<{ value: number; count: string }>(
        sql`SELECT l.category_id AS value, count(*) AS count FROM listings l WHERE ${where} GROUP BY l.category_id ORDER BY count DESC LIMIT 30`,
      );
      facets.categoryId = cat.rows.map((r) => ({ value: String(r.value), count: Number(r.count) }));
      for (const fa of q.facetAttributes ?? []) {
        const r = await this.db.execute<{ value: string; count: string }>(
          sql`SELECT v.value_text AS value, count(DISTINCT l.id) AS count FROM listings l JOIN listing_attribute_values v ON v.listing_id = l.id AND v.attribute_id = ${fa.attributeId} WHERE ${where} AND v.value_text IS NOT NULL GROUP BY v.value_text ORDER BY count DESC LIMIT 50`,
        );
        facets[fa.key] = r.rows.map((x) => ({ value: x.value, count: Number(x.count) }));
      }
    }
    const distances: Record<string, number> = {};
    for (const r of rows.rows) if (r.dist !== null) distances[r.id] = Math.round(Number(r.dist) * 10) / 10;
    return { ids: rows.rows.map((r) => r.id), total, distances, facets };
  }

  async suggest(prefix: string, limit: number): Promise<string[]> {
    const r = await this.db.execute<{ title: string }>(
      sql`SELECT lower(title) AS title, max(word_similarity(${prefix}, title)) AS s
          FROM listings WHERE status = 'active' AND (title ILIKE ${`%${prefix.replace(/[\\%_]/g, '\\$&')}%`} OR word_similarity(${prefix}, title) > 0.5)
          GROUP BY lower(title) ORDER BY s DESC, count(*) DESC LIMIT ${limit}`,
    );
    return r.rows.map((x) => x.title);
  }

  async mapPoints(q: ResolvedQuery, limit: number) {
    const where = sql.join([...this.where(q), sql`l.lat IS NOT NULL AND l.lng IS NOT NULL`], sql` AND `);
    const r = await this.db.execute<{ id: string; lat: number; lng: number; price: number | null; title: string }>(
      sql`SELECT l.id, l.lat, l.lng, l.price, l.title FROM listings l WHERE ${where} ORDER BY l.bumped_at DESC LIMIT ${limit}`,
    );
    return r.rows.map((x) => ({ ...x, price: x.price === null ? null : Number(x.price) }));
  }

  async index(_doc: ListingSearchDoc) {
    // Данные читаются напрямую из таблиц.
  }
  async remove(_id: string) {}
  async ensureIndex() {}
  async ping() {
    await this.db.execute(sql`SELECT 1`);
    return true;
  }
}
