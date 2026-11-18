import type { SearchSort } from '@lotok/shared';

export interface AttrFilter {
  attributeId: number;
  key: string;
  kind: 'terms' | 'range' | 'bool';
  values?: string[];
  min?: number;
  max?: number;
  bool?: boolean;
}

/** Запрос поиска после разрешения категорий/регионов/характеристик. */
export interface ResolvedQuery {
  q?: string;
  categoryIds?: number[];
  cityIds?: number[];
  priceMin?: number;
  priceMax?: number;
  condition?: 'new' | 'used';
  delivery?: boolean;
  withPhoto?: boolean;
  sellerId?: string;
  geo?: { lat: number; lng: number; radiusKm: number };
  bbox?: { south: number; west: number; north: number; east: number };
  attrs: AttrFilter[];
  sort: SearchSort;
  page: number;
  limit: number;
  publishedAfter?: Date;
  /** Только объявления с активным премиум-размещением (отдельный рекламный блок). */
  premiumOnly?: boolean;
  excludeIds?: string[];
  /** Категории для фасетов по характеристикам. */
  facetAttributes?: { key: string; attributeId: number }[];
}

export interface EngineResult {
  ids: string[];
  total: number;
  distances: Record<string, number>;
  facets: Record<string, { value: string; count: number }[]>;
}

export interface ListingSearchDoc {
  id: string;
  title: string;
  description: string;
  categoryId: number;
  categoryPath: number[];
  categoryNames: string[];
  cityId: number;
  regionPath: number[];
  price: number | null;
  priceType: string;
  condition: string | null;
  delivery: boolean;
  hasPhoto: boolean;
  sellerId: string;
  location: { lat: number; lon: number } | null;
  publishedAt: string | null;
  bumpedAt: string | null;
  attrs: Record<string, string[]>;
  attrsNum: Record<string, number>;
  attrsBool: Record<string, boolean>;
  premiumUntil: string | null;
}

export interface SearchEngine {
  readonly name: 'postgres' | 'opensearch';
  search(q: ResolvedQuery): Promise<EngineResult>;
  suggest(prefix: string, limit: number): Promise<string[]>;
  mapPoints(q: ResolvedQuery, limit: number): Promise<{ id: string; lat: number; lng: number; price: number | null; title: string }[]>;
  index(doc: ListingSearchDoc): Promise<void>;
  remove(id: string): Promise<void>;
  ensureIndex(): Promise<void>;
  ping(): Promise<boolean>;
}

export const SEARCH_ENGINE = Symbol('SEARCH_ENGINE');
