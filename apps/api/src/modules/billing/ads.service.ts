import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, inArray, lte, sql } from 'drizzle-orm';
import type { AdPlacementDto } from '@lotok/shared';
import { DB, type Db } from '../../database/database.module';
import { adPlacements } from '../../database/schema';
import { Errors } from '../../common/errors';

/**
 * Рекламные размещения (баннеры). Каждое размещение обязано иметь токен erid из ОРД
 * и данные рекламодателя — требование ст. 18.1 Закона «О рекламе».
 */
@Injectable()
export class AdsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async active(slot: string): Promise<AdPlacementDto[]> {
    const now = new Date();
    const rows = await this.db
      .select()
      .from(adPlacements)
      .where(and(eq(adPlacements.slot, slot), eq(adPlacements.isActive, true), lte(adPlacements.startsAt, now), gt(adPlacements.endsAt, now)))
      .limit(3);
    if (rows.length) {
      await this.db
        .update(adPlacements)
        .set({ impressions: sql`${adPlacements.impressions} + 1` })
        .where(inArray(adPlacements.id, rows.map((r) => r.id)));
    }
    return rows.map((r) => ({ id: r.id, slot: r.slot, title: r.title, imageUrl: r.imageUrl, targetUrl: r.targetUrl, advertiser: r.advertiser, erid: r.erid }));
  }

  async click(id: string) {
    const [r] = await this.db
      .update(adPlacements)
      .set({ clicks: sql`${adPlacements.clicks} + 1` })
      .where(eq(adPlacements.id, id))
      .returning({ targetUrl: adPlacements.targetUrl, erid: adPlacements.erid });
    if (!r) throw Errors.notFound('Реклама');
    const url = new URL(r.targetUrl);
    url.searchParams.set('erid', r.erid);
    return { url: url.toString() };
  }

  list() {
    return this.db.select().from(adPlacements).orderBy(desc(adPlacements.createdAt));
  }

  async upsert(input: Omit<typeof adPlacements.$inferInsert, 'id' | 'startsAt' | 'endsAt'> & { startsAt: string; endsAt: string }, id?: string) {
    const values = { ...input, startsAt: new Date(input.startsAt), endsAt: new Date(input.endsAt) };
    if (values.endsAt <= values.startsAt) throw Errors.badRequest('invalid_period', 'Дата окончания раньше начала');
    if (id) {
      const [before] = await this.db.select().from(adPlacements).where(eq(adPlacements.id, id));
      if (!before) throw Errors.notFound('Размещение');
      const [after] = await this.db.update(adPlacements).set({ ...values, updatedAt: new Date() }).where(eq(adPlacements.id, id)).returning();
      return { before, after };
    }
    const [after] = await this.db.insert(adPlacements).values(values).returning();
    return { before: null, after };
  }
}
