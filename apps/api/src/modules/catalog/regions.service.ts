import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, ilike, inArray } from 'drizzle-orm';
import Redis from 'ioredis';
import type { RegionDto } from '@lotok/shared';
import { DB, type Db } from '../../database/database.module';
import { regions } from '../../database/schema';
import { REDIS } from '../../infra/redis.module';
import { Errors } from '../../common/errors';
import { escapeLike } from '../../common/util';

type RegionRow = typeof regions.$inferSelect;
const KEY = 'catalog:regions:v1';

const dto = (r: RegionRow): RegionDto => ({ id: r.id, parentId: r.parentId, type: r.type, name: r.name, slug: r.slug, lat: r.lat, lng: r.lng });

/** Справочник регионов: страна → субъект → город → район. Мультистрановость через country_code. */
@Injectable()
export class RegionsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async all(): Promise<RegionRow[]> {
    const c = await this.redis.get(KEY);
    if (c) return JSON.parse(c);
    const rows = await this.db.select().from(regions).orderBy(asc(regions.sort), asc(regions.name));
    await this.redis.set(KEY, JSON.stringify(rows), 'EX', 600);
    return rows;
  }

  async invalidate() {
    await this.redis.del(KEY);
  }

  async get(id: number): Promise<RegionRow> {
    const r = (await this.all()).find((x) => x.id === id);
    if (!r) throw Errors.notFound('Регион');
    return r;
  }

  async getDto(id: number) {
    return dto(await this.get(id));
  }

  async cities(popularOnly = false): Promise<RegionDto[]> {
    const rows = (await this.all()).filter((r) => r.type === 'city' && r.isActive);
    return (popularOnly ? rows.filter((r) => r.sort < 100) : rows).map(dto);
  }

  async children(parentId: number | null) {
    return (await this.all()).filter((r) => r.parentId === parentId && r.isActive).map(dto);
  }

  async search(q: string, limit = 20) {
    const rows = await this.db
      .select()
      .from(regions)
      .where(and(ilike(regions.name, `${escapeLike(q)}%`), eq(regions.isActive, true), inArray(regions.type, ['city', 'region'])))
      .orderBy(asc(regions.sort), asc(regions.name))
      .limit(limit);
    return rows.map(dto);
  }

  /** Город и все его районы; для субъекта — все входящие города. */
  async descendantIds(id: number): Promise<number[]> {
    const all = await this.all();
    const out = [id];
    for (let i = 0; i < out.length; i++) for (const r of all) if (r.parentId === out[i]) out.push(r.id);
    return out;
  }

  async create(input: Omit<typeof regions.$inferInsert, 'id'>) {
    const [r] = await this.db.insert(regions).values(input).returning();
    await this.invalidate();
    return dto(r);
  }

  async update(id: number, input: Partial<typeof regions.$inferInsert>) {
    const before = await this.get(id);
    const [r] = await this.db.update(regions).set(input).where(eq(regions.id, id)).returning();
    await this.invalidate();
    return { before: dto(before), after: dto(r) };
  }
}
