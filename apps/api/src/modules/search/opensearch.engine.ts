import { Client } from '@opensearch-project/opensearch';
import { expandQuery } from './synonyms';
import type { AppConfig } from '../../config/config';
import type { EngineResult, ListingSearchDoc, ResolvedQuery, SearchEngine } from './search.types';

type Q = Record<string, unknown>;

/**
 * OpenSearch: морфология (russian analyzer), нечёткий поиск (fuzziness AUTO), автодополнение
 * (search_as_you_type), гео-фильтры (geo_point), агрегации для фасетов.
 * Индекс — производная проекция из PostgreSQL; при потере пересоздаётся задачей reindex.
 */
export class OpenSearchEngine implements SearchEngine {
  readonly name = 'opensearch' as const;
  private readonly client: Client;
  private readonly index_: string;
  private readonly refreshMode: 'false' | 'wait_for';

  constructor(config: AppConfig) {
    this.client = new Client({
      node: config.OPENSEARCH_URL,
      auth: config.OPENSEARCH_USERNAME ? { username: config.OPENSEARCH_USERNAME, password: config.OPENSEARCH_PASSWORD ?? '' } : undefined,
      requestTimeout: 10_000,
    });
    this.index_ = config.OPENSEARCH_INDEX;
    this.refreshMode = config.OPENSEARCH_REFRESH;
  }

  private ensured: Promise<void> | null = null;

  /** Индекс со схемой создаётся до первой записи/поиска — иначе OpenSearch создаст его с динамической схемой. */
  private ready(): Promise<void> {
    this.ensured ??= this.ensureIndex().catch((e) => {
      this.ensured = null;
      throw e;
    });
    return this.ensured;
  }

  async ensureIndex() {
    const exists = await this.client.indices.exists({ index: this.index_ });
    if (exists.body === true || exists.statusCode === 200) return;
    await this.client.indices.create({
      index: this.index_,
      body: {
        settings: {
          number_of_shards: 1,
          number_of_replicas: 0,
          analysis: {
            filter: {
              ru_stop: { type: 'stop', stopwords: '_russian_' },
              ru_stemmer: { type: 'stemmer', language: 'russian' },
            },
            analyzer: {
              ru: { type: 'custom', tokenizer: 'standard', filter: ['lowercase', 'ru_stop', 'ru_stemmer'], char_filter: ['yo'] },
            },
            char_filter: { yo: { type: 'mapping', mappings: ['ё => е', 'Ё => Е'] } },
          },
        },
        mappings: {
          dynamic: 'strict',
          properties: {
            id: { type: 'keyword' },
            title: { type: 'text', analyzer: 'ru', fields: { suggest: { type: 'search_as_you_type' }, raw: { type: 'keyword', ignore_above: 256 } } },
            description: { type: 'text', analyzer: 'ru' },
            categoryId: { type: 'integer' },
            categoryPath: { type: 'integer' },
            categoryNames: { type: 'text', analyzer: 'ru' },
            cityId: { type: 'integer' },
            regionPath: { type: 'integer' },
            price: { type: 'long' },
            priceType: { type: 'keyword' },
            condition: { type: 'keyword' },
            delivery: { type: 'boolean' },
            hasPhoto: { type: 'boolean' },
            sellerId: { type: 'keyword' },
            location: { type: 'geo_point' },
            publishedAt: { type: 'date' },
            bumpedAt: { type: 'date' },
            premiumUntil: { type: 'date' },
            attrs: { type: 'object', dynamic: true },
            attrsNum: { type: 'object', dynamic: true },
            attrsBool: { type: 'object', dynamic: true },
          },
          dynamic_templates: [
            { attrs_kw: { path_match: 'attrs.*', mapping: { type: 'keyword' } } },
            { attrs_num: { path_match: 'attrsNum.*', mapping: { type: 'double' } } },
            { attrs_bool: { path_match: 'attrsBool.*', mapping: { type: 'boolean' } } },
          ],
        },
      },
    }).catch((e: { meta?: { body?: { error?: { type?: string } } } }) => {
      // Параллельный старт реплик: индекс уже создан другой репликой.
      if (e?.meta?.body?.error?.type !== 'resource_already_exists_exception') throw e;
    });
  }

  private filters(q: ResolvedQuery): Q[] {
    const f: Q[] = [];
    if (q.categoryIds?.length) f.push({ terms: { categoryId: q.categoryIds } });
    if (q.cityIds?.length) f.push({ terms: { cityId: q.cityIds } });
    if (q.priceMin !== undefined || q.priceMax !== undefined) f.push({ range: { price: { gte: q.priceMin, lte: q.priceMax } } });
    if (q.condition) f.push({ term: { condition: q.condition } });
    if (q.delivery) f.push({ term: { delivery: true } });
    if (q.withPhoto) f.push({ term: { hasPhoto: true } });
    if (q.sellerId) f.push({ term: { sellerId: q.sellerId } });
    if (q.publishedAfter) f.push({ range: { publishedAt: { gt: q.publishedAfter.toISOString() } } });
    if (q.geo) f.push({ geo_distance: { distance: `${q.geo.radiusKm}km`, location: { lat: q.geo.lat, lon: q.geo.lng } } });
    if (q.bbox) {
      f.push({ geo_bounding_box: { location: { top_left: { lat: q.bbox.north, lon: q.bbox.west }, bottom_right: { lat: q.bbox.south, lon: q.bbox.east } } } });
    }
    if (q.premiumOnly) f.push({ range: { premiumUntil: { gt: 'now' } } });
    for (const a of q.attrs) {
      if (a.kind === 'terms' && a.values?.length) f.push({ terms: { [`attrs.${a.key}`]: a.values } });
      if (a.kind === 'range') f.push({ range: { [`attrsNum.${a.key}`]: { gte: a.min, lte: a.max } } });
      if (a.kind === 'bool') f.push({ term: { [`attrsBool.${a.key}`]: !!a.bool } });
    }
    return f;
  }

  private mustNot(q: ResolvedQuery): Q[] {
    return q.excludeIds?.length ? [{ ids: { values: q.excludeIds } }] : [];
  }

  async search(q: ResolvedQuery): Promise<EngineResult> {
    await this.ready();
    const must: Q[] = q.q
      ? [
          {
            bool: {
              should: expandQuery(q.q).map((v, i) => ({
                multi_match: { query: v, fields: ['title^3', 'categoryNames^2', 'description'], fuzziness: 'AUTO', prefix_length: 1, operator: 'and', boost: i === 0 ? 1.2 : 1 },
              })),
              minimum_should_match: 1,
            },
          },
        ]
      : [{ match_all: {} }];
    const sort: Q[] = [];
    switch (q.sort) {
      case 'price_asc':
        sort.push({ price: { order: 'asc', missing: '_last' } });
        break;
      case 'price_desc':
        sort.push({ price: { order: 'desc', missing: '_last' } });
        break;
      case 'date_desc':
        sort.push({ bumpedAt: 'desc' });
        break;
      case 'distance':
        if (q.geo) sort.push({ _geo_distance: { location: { lat: q.geo.lat, lon: q.geo.lng }, order: 'asc', unit: 'km' } });
        break;
      default:
        if (q.q) sort.push({ _score: 'desc' });
    }
    sort.push({ bumpedAt: 'desc' }, { id: 'asc' });
    const aggs: Q = {};
    if (!q.premiumOnly) {
      aggs.categoryId = { terms: { field: 'categoryId', size: 30 } };
      for (const fa of q.facetAttributes ?? []) aggs[fa.key] = { terms: { field: `attrs.${fa.key}`, size: 50 } };
    }
    const res = await this.client.search({
      index: this.index_,
      body: {
        from: (q.page - 1) * q.limit,
        size: q.limit,
        track_total_hits: 10_000,
        query: { bool: { must, filter: this.filters(q), must_not: this.mustNot(q) } },
        sort,
        aggs,
        _source: false,
      },
    });
    const body = res.body as {
      hits: { total: { value: number }; hits: { _id: string; sort?: unknown[] }[] };
      aggregations?: Record<string, { buckets: { key: string | number; doc_count: number }[] }>;
    };
    const distances: Record<string, number> = {};
    if (q.sort === 'distance' && q.geo) {
      for (const h of body.hits.hits) if (typeof h.sort?.[0] === 'number') distances[h._id] = Math.round((h.sort[0] as number) * 10) / 10;
    }
    const facets: EngineResult['facets'] = {};
    for (const [k, v] of Object.entries(body.aggregations ?? {})) facets[k] = v.buckets.map((b) => ({ value: String(b.key), count: b.doc_count }));
    return { ids: body.hits.hits.map((h) => h._id), total: body.hits.total.value, distances, facets };
  }

  async suggest(prefix: string, limit: number) {
    await this.ready();
    const res = await this.client.search({
      index: this.index_,
      body: {
        size: limit * 3,
        query: {
          multi_match: { query: prefix, type: 'bool_prefix', fields: ['title.suggest', 'title.suggest._2gram', 'title.suggest._3gram'], fuzziness: 'AUTO' },
        },
        _source: ['title'],
      },
    });
    const hits = (res.body as { hits: { hits: { _source: { title: string } }[] } }).hits.hits;
    const seen = new Set<string>();
    const out: string[] = [];
    for (const h of hits) {
      const t = h._source.title.toLowerCase();
      if (!seen.has(t)) {
        seen.add(t);
        out.push(t);
      }
      if (out.length >= limit) break;
    }
    return out;
  }

  async mapPoints(q: ResolvedQuery, limit: number) {
    await this.ready();
    const res = await this.client.search({
      index: this.index_,
      body: {
        size: limit,
        query: { bool: { filter: [...this.filters(q), { exists: { field: 'location' } }], must: q.q ? [{ match: { title: { query: q.q, fuzziness: 'AUTO' } } }] : [] } },
        sort: [{ bumpedAt: 'desc' }],
        _source: ['location', 'price', 'title'],
      },
    });
    const hits = (res.body as { hits: { hits: { _id: string; _source: { location: { lat: number; lon: number }; price: number | null; title: string } }[] } }).hits.hits;
    return hits.map((h) => ({ id: h._id, lat: h._source.location.lat, lng: h._source.location.lon, price: h._source.price, title: h._source.title }));
  }

  async index(doc: ListingSearchDoc) {
    await this.ready();
    await this.client.index({ index: this.index_, id: doc.id, body: doc as unknown as Record<string, unknown>, refresh: this.refreshMode === 'wait_for' ? 'wait_for' : false });
  }

  async remove(id: string) {
    await this.ready();
    await this.client.delete({ index: this.index_, id, refresh: this.refreshMode === 'wait_for' ? 'wait_for' : false }).catch((e: { meta?: { statusCode?: number } }) => {
      if (e?.meta?.statusCode !== 404) throw e;
    });
  }

  async refresh() {
    await this.client.indices.refresh({ index: this.index_ });
  }

  async ping() {
    const r = await this.client.cluster.health({});
    return r.body.status !== 'red';
  }
}
