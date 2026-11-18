import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, inArray } from 'drizzle-orm';
import Redis from 'ioredis';
import type {
  AttributeInput,
  AttributeValue,
  CategoryAttributeDto,
  CategoryDto,
  CategoryInput,
  ListingAttributeDisplay,
} from '@lotok/shared';
import { DB, type Db, type DbOrTx } from '../../database/database.module';
import { attributeOptions, attributes, categories, categoryAttributes, listings } from '../../database/schema';
import { REDIS } from '../../infra/redis.module';
import { Errors } from '../../common/errors';

type CategoryRow = typeof categories.$inferSelect;

export interface NormalizedAttributeValue {
  attributeId: number;
  valueText: string | null;
  valueNumber: number | null;
  valueBool: boolean | null;
}

const CACHE_KEY = 'catalog:categories:v1';

function toDto(c: CategoryRow): CategoryDto {
  return {
    id: c.id,
    parentId: c.parentId,
    slug: c.slug,
    name: c.name,
    vertical: c.vertical,
    icon: c.icon,
    sort: c.sort,
    isActive: c.isActive,
    allowDelivery: c.allowDelivery,
    allowVideo: c.allowVideo,
    maxPhotos: c.maxPhotos,
    freeListingLimit: c.freeListingLimit,
    requiresManualModeration: c.requiresManualModeration,
  };
}

/**
 * Категории и характеристики управляются из админки; интерфейс строит формы и фильтры
 * по ответу этого сервиса. Дочерние категории наследуют характеристики родителей.
 */
@Injectable()
export class CategoriesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async all(): Promise<CategoryRow[]> {
    const cached = await this.redis.get(CACHE_KEY);
    if (cached) return (JSON.parse(cached) as CategoryRow[]).map((c) => ({ ...c, createdAt: new Date(c.createdAt), updatedAt: new Date(c.updatedAt) }));
    const rows = await this.db.select().from(categories).orderBy(asc(categories.sort), asc(categories.name));
    await this.redis.set(CACHE_KEY, JSON.stringify(rows), 'EX', 300);
    return rows;
  }

  async invalidate() {
    await this.redis.del(CACHE_KEY);
    const keys = await this.redis.keys('catalog:attrs:*');
    if (keys.length) await this.redis.del(...keys);
  }

  async tree(includeInactive = false): Promise<CategoryDto[]> {
    const rows = (await this.all()).filter((c) => includeInactive || c.isActive);
    const byParent = new Map<number | null, CategoryDto[]>();
    for (const r of rows) {
      const list = byParent.get(r.parentId) ?? [];
      list.push(toDto(r));
      byParent.set(r.parentId, list);
    }
    const attach = (nodes: CategoryDto[]): CategoryDto[] =>
      nodes.map((n) => ({ ...n, children: attach(byParent.get(n.id) ?? []) }));
    return attach(byParent.get(null) ?? []);
  }

  async get(id: number): Promise<CategoryRow> {
    const c = (await this.all()).find((x) => x.id === id);
    if (!c) throw Errors.notFound('Категория');
    return c;
  }

  async getBySlug(slug: string) {
    const c = (await this.all()).find((x) => x.slug === slug && x.isActive);
    if (!c) throw Errors.notFound('Категория');
    return { ...toDto(c), path: await this.path(c.id), children: (await this.all()).filter((x) => x.parentId === c.id && x.isActive).map(toDto) };
  }

  /** Путь от корня до категории (хлебные крошки). */
  async path(id: number): Promise<{ id: number; name: string; slug: string }[]> {
    const all = await this.all();
    const out: { id: number; name: string; slug: string }[] = [];
    let cur = all.find((c) => c.id === id);
    let guard = 0;
    while (cur && guard++ < 20) {
      out.unshift({ id: cur.id, name: cur.name, slug: cur.slug });
      cur = cur.parentId ? all.find((c) => c.id === cur!.parentId) : undefined;
    }
    return out;
  }

  async descendantIds(id: number): Promise<number[]> {
    const all = await this.all();
    const out = [id];
    for (let i = 0; i < out.length; i++) for (const c of all) if (c.parentId === out[i]) out.push(c.id);
    return out;
  }

  async isLeaf(id: number) {
    return !(await this.all()).some((c) => c.parentId === id);
  }

  /** Ближайшая по иерархии категория с заданным лимитом бесплатных публикаций. */
  async limitCategory(id: number): Promise<CategoryRow | null> {
    const all = await this.all();
    let cur = all.find((c) => c.id === id);
    while (cur) {
      if (cur.freeListingLimit !== null) return cur;
      cur = cur.parentId ? all.find((c) => c.id === cur!.parentId) : undefined;
    }
    return null;
  }

  async attributesFor(categoryId: number): Promise<CategoryAttributeDto[]> {
    const key = `catalog:attrs:${categoryId}`;
    const cached = await this.redis.get(key);
    if (cached) return JSON.parse(cached);
    const pathIds = (await this.path(categoryId)).map((p) => p.id);
    if (!pathIds.length) throw Errors.notFound('Категория');
    const links = await this.db
      .select({ link: categoryAttributes, attr: attributes })
      .from(categoryAttributes)
      .innerJoin(attributes, eq(attributes.id, categoryAttributes.attributeId))
      .where(inArray(categoryAttributes.categoryId, pathIds));
    // Ближайшая к листу категория переопределяет настройки родителя.
    const byAttr = new Map<number, (typeof links)[number]>();
    for (const id of pathIds) for (const l of links.filter((x) => x.link.categoryId === id)) byAttr.set(l.attr.id, l);
    const attrIds = [...byAttr.keys()];
    const opts = attrIds.length
      ? await this.db.select().from(attributeOptions).where(inArray(attributeOptions.attributeId, attrIds)).orderBy(asc(attributeOptions.sort), asc(attributeOptions.label))
      : [];
    const keyById = new Map([...byAttr.values()].map((l) => [l.attr.id, l.attr.key]));
    const result: CategoryAttributeDto[] = [...byAttr.values()]
      .sort((a, b) => a.link.sort - b.link.sort)
      .map(({ link, attr }) => ({
        id: attr.id,
        key: attr.key,
        name: attr.name,
        type: attr.type,
        unit: attr.unit,
        minValue: attr.minValue,
        maxValue: attr.maxValue,
        isRequired: link.isRequired,
        isFilterable: link.isFilterable,
        showInCard: link.showInCard,
        sort: link.sort,
        dependsOn: attr.dependsOnAttributeId ? (keyById.get(attr.dependsOnAttributeId) ?? null) : null,
        options: opts.filter((o) => o.attributeId === attr.id).map((o) => ({ value: o.value, label: o.label, parentValue: o.parentValue })),
      }));
    await this.redis.set(key, JSON.stringify(result), 'EX', 300);
    return result;
  }

  /**
   * Проверка и нормализация значений характеристик объявления по определениям категории.
   * Возвращает строки для listing_attribute_values; при ошибках — 400 с перечнем полей.
   */
  async validateAttributes(categoryId: number, values: Record<string, AttributeValue>, requireAll: boolean): Promise<NormalizedAttributeValue[]> {
    const defs = await this.attributesFor(categoryId);
    const errors: { path: string; message: string }[] = [];
    const out: NormalizedAttributeValue[] = [];
    for (const key of Object.keys(values)) {
      if (!defs.some((d) => d.key === key)) errors.push({ path: `attributes.${key}`, message: 'Неизвестная характеристика для этой категории' });
    }
    for (const d of defs) {
      const raw = values[d.key];
      const empty = raw === undefined || raw === null || raw === '' || (Array.isArray(raw) && raw.length === 0);
      if (empty) {
        if (requireAll && d.isRequired) errors.push({ path: `attributes.${d.key}`, message: `Укажите «${d.name}»` });
        continue;
      }
      const err = (message: string) => errors.push({ path: `attributes.${d.key}`, message });
      switch (d.type) {
        case 'integer':
        case 'year':
        case 'decimal': {
          const n = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.'));
          if (!Number.isFinite(n)) {
            err('Должно быть числом');
            break;
          }
          if (d.type !== 'decimal' && !Number.isInteger(n)) {
            err('Должно быть целым числом');
            break;
          }
          const min = d.type === 'year' ? (d.minValue ?? 1900) : d.minValue;
          const max = d.type === 'year' ? (d.maxValue ?? new Date().getFullYear() + 1) : d.maxValue;
          if (min !== null && n < min) err(`Не меньше ${min}`);
          else if (max !== null && n > max) err(`Не больше ${max}`);
          else out.push({ attributeId: d.id, valueText: null, valueNumber: n, valueBool: null });
          break;
        }
        case 'boolean': {
          const b = typeof raw === 'boolean' ? raw : raw === 'true' || raw === '1';
          out.push({ attributeId: d.id, valueText: null, valueNumber: null, valueBool: b });
          break;
        }
        case 'enum': {
          const v = String(raw);
          const opt = d.options.find((o) => o.value === v);
          if (!opt) {
            err('Выберите значение из списка');
            break;
          }
          if (d.dependsOn && opt.parentValue) {
            const parentVal = values[d.dependsOn];
            if (parentVal !== undefined && String(parentVal) !== opt.parentValue) {
              err('Значение не соответствует выбранному родительскому значению');
              break;
            }
          }
          out.push({ attributeId: d.id, valueText: v, valueNumber: null, valueBool: null });
          break;
        }
        case 'multi_enum': {
          const arr = Array.isArray(raw) ? raw : String(raw).split(',');
          const invalid = arr.filter((v) => !d.options.some((o) => o.value === v));
          if (invalid.length) {
            err(`Недопустимые значения: ${invalid.join(', ')}`);
            break;
          }
          for (const v of new Set(arr)) out.push({ attributeId: d.id, valueText: v, valueNumber: null, valueBool: null });
          break;
        }
        case 'string': {
          const s = String(raw).trim();
          if (s.length > 500) err('Не длиннее 500 символов');
          else out.push({ attributeId: d.id, valueText: s, valueNumber: null, valueBool: null });
          break;
        }
      }
    }
    if (errors.length) throw Errors.badRequest('validation_error', 'Проверьте характеристики объявления', errors);
    return out;
  }

  /** Представление значений для карточки объявления. */
  async displayAttributes(
    categoryId: number,
    rows: { attributeId: number; valueText: string | null; valueNumber: number | null; valueBool: boolean | null }[],
  ): Promise<ListingAttributeDisplay[]> {
    const defs = await this.attributesFor(categoryId);
    const out: ListingAttributeDisplay[] = [];
    for (const d of defs) {
      const mine = rows.filter((r) => r.attributeId === d.id);
      if (!mine.length) continue;
      let value: ListingAttributeDisplay['value'];
      let display: string;
      switch (d.type) {
        case 'boolean':
          value = !!mine[0].valueBool;
          display = value ? 'Да' : 'Нет';
          break;
        case 'integer':
        case 'decimal':
        case 'year':
          value = mine[0].valueNumber ?? 0;
          display = `${d.type === 'year' ? value : new Intl.NumberFormat('ru-RU').format(value)}${d.unit ? ` ${d.unit}` : ''}`;
          break;
        case 'enum':
          value = mine[0].valueText ?? '';
          display = d.options.find((o) => o.value === value)?.label ?? String(value);
          break;
        case 'multi_enum':
          value = mine.map((m) => m.valueText ?? '');
          display = (value as string[]).map((v) => d.options.find((o) => o.value === v)?.label ?? v).join(', ');
          break;
        default:
          value = mine[0].valueText ?? '';
          display = String(value);
      }
      out.push({ key: d.key, name: d.name, type: d.type, value, display });
    }
    return out;
  }

  /* ------------------------------ admin ------------------------------ */

  async create(input: CategoryInput) {
    if (input.parentId) await this.get(input.parentId);
    const [row] = await this.db.insert(categories).values(input).returning();
    await this.invalidate();
    return toDto(row);
  }

  async update(id: number, input: Partial<CategoryInput>) {
    const before = await this.get(id);
    if (input.parentId) {
      if ((await this.descendantIds(id)).includes(input.parentId)) throw Errors.badRequest('category_cycle', 'Нельзя перенести категорию внутрь самой себя');
    }
    const [row] = await this.db
      .update(categories)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(categories.id, id))
      .returning();
    await this.invalidate();
    return { before: toDto(before), after: toDto(row) };
  }

  async remove(id: number) {
    const before = await this.get(id);
    const [{ n: children }] = await this.db.select({ n: count() }).from(categories).where(eq(categories.parentId, id));
    const [{ n: used }] = await this.db.select({ n: count() }).from(listings).where(eq(listings.categoryId, id));
    if (children || used) throw Errors.conflict('category_in_use', 'Категория содержит подкатегории или объявления — деактивируйте её вместо удаления');
    await this.db.delete(categories).where(eq(categories.id, id));
    await this.invalidate();
    return toDto(before);
  }

  async listAttributes() {
    const attrs = await this.db.select().from(attributes).orderBy(asc(attributes.key));
    const opts = await this.db.select().from(attributeOptions).orderBy(asc(attributeOptions.sort));
    return attrs.map((a) => ({ ...a, options: opts.filter((o) => o.attributeId === a.id) }));
  }

  async upsertAttribute(input: AttributeInput, id?: number, tx: DbOrTx = this.db) {
    return tx.transaction(async (t) => {
      const values = {
        key: input.key,
        name: input.name,
        type: input.type,
        unit: input.unit ?? null,
        minValue: input.minValue ?? null,
        maxValue: input.maxValue ?? null,
        dependsOnAttributeId: input.dependsOnAttributeId ?? null,
      };
      const [row] = id
        ? await t.update(attributes).set({ ...values, updatedAt: new Date() }).where(eq(attributes.id, id)).returning()
        : await t.insert(attributes).values(values).returning();
      if (!row) throw Errors.notFound('Характеристика');
      if (input.options) {
        const existing = await t.select().from(attributeOptions).where(eq(attributeOptions.attributeId, row.id));
        const keep = new Set(input.options.map((o) => o.value));
        const toDelete = existing.filter((e) => !keep.has(e.value)).map((e) => e.id);
        if (toDelete.length) await t.delete(attributeOptions).where(inArray(attributeOptions.id, toDelete));
        for (const [i, o] of input.options.entries()) {
          await t
            .insert(attributeOptions)
            .values({ attributeId: row.id, value: o.value, label: o.label, parentValue: o.parentValue ?? null, sort: i })
            .onConflictDoUpdate({
              target: [attributeOptions.attributeId, attributeOptions.value],
              set: { label: o.label, parentValue: o.parentValue ?? null, sort: i },
            });
        }
      }
      return row;
    }).finally(() => this.invalidate());
  }

  async linkAttribute(categoryId: number, link: { attributeId: number; isRequired: boolean; isFilterable: boolean; showInCard: boolean; sort: number }) {
    await this.get(categoryId);
    await this.db
      .insert(categoryAttributes)
      .values({ categoryId, ...link })
      .onConflictDoUpdate({
        target: [categoryAttributes.categoryId, categoryAttributes.attributeId],
        set: { isRequired: link.isRequired, isFilterable: link.isFilterable, showInCard: link.showInCard, sort: link.sort },
      });
    await this.invalidate();
  }

  async unlinkAttribute(categoryId: number, attributeId: number) {
    await this.db.delete(categoryAttributes).where(and(eq(categoryAttributes.categoryId, categoryId), eq(categoryAttributes.attributeId, attributeId)));
    await this.invalidate();
  }
}
