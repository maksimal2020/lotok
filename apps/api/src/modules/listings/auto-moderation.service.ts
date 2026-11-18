import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, gte, ne } from 'drizzle-orm';
import Redis from 'ioredis';
import { DB, type Db } from '../../database/database.module';
import { listings, listingStatusHistory, moderationDecisions, stopWords, users } from '../../database/schema';
import { REDIS } from '../../infra/redis.module';
import { SettingsService } from '../../infra/platform.services';
import { CategoriesService } from '../catalog/categories.service';
import { addDays } from '../../common/util';
import type { ListingRow } from './listing.presenter';

export interface AutoModerationResult {
  decision: 'approve' | 'reject' | 'manual';
  flags: string[];
  reason: string | null;
}

const PHONE_RE = /(\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/;
const URL_RE = /(https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(ru|com|net|org|рф|su|io)\b/i;
const MESSENGER_RE = /\b(telegram|телеграм|whatsapp|ватсап|вотсап|viber|вайбер)\b|@[a-z0-9_]{5,}/i;

/**
 * Автоматическая модерация — детерминированные правила (не ML):
 * стоп-слова, контакты и ссылки в тексте, ценовые аномалии, дубликаты, доверие к аккаунту.
 * Решения: approve (опубликовать), reject (отклонить с причиной), manual (очередь модератора).
 */
@Injectable()
export class AutoModerationService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly categories: CategoriesService,
    private readonly settings: SettingsService,
  ) {}

  async stopWordList(): Promise<{ word: string; action: string }[]> {
    const c = await this.redis.get('moderation:stopwords');
    if (c) return JSON.parse(c);
    const rows = await this.db.select({ word: stopWords.word, action: stopWords.action }).from(stopWords);
    await this.redis.set('moderation:stopwords', JSON.stringify(rows), 'EX', 120);
    return rows;
  }

  async invalidateStopWords() {
    await this.redis.del('moderation:stopwords');
  }

  async evaluate(row: ListingRow): Promise<AutoModerationResult> {
    const flags: string[] = [];
    const text = `${row.title}\n${row.description}`.toLowerCase().replace(/ё/g, 'е');

    for (const sw of await this.stopWordList()) {
      const w = sw.word.toLowerCase().replace(/ё/g, 'е');
      const re = new RegExp(`(^|[^\\p{L}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u');
      if (re.test(text)) {
        if (sw.action === 'reject') return { decision: 'reject', flags: [`stop_word:${sw.word}`], reason: 'Объявление содержит запрещённые товары или услуги' };
        flags.push(`stop_word:${sw.word}`);
      }
    }
    if (PHONE_RE.test(row.title) || URL_RE.test(row.title)) {
      return { decision: 'reject', flags: ['contacts_in_title'], reason: 'Не указывайте контакты и ссылки в названии объявления' };
    }
    if (URL_RE.test(row.description)) flags.push('links_in_description');
    if (PHONE_RE.test(row.description) || MESSENGER_RE.test(row.description)) flags.push('contacts_in_description');

    const category = await this.categories.get(row.categoryId);
    if (category.requiresManualModeration) flags.push('category_manual');
    if (row.priceType === 'fixed' && row.price !== null) {
      if (row.price === 0) flags.push('zero_price');
      if (category.vertical === 'auto' && row.price < 10_000_00) flags.push('price_anomaly');
      if (category.vertical === 'realty' && row.price < 1_000_00) flags.push('price_anomaly');
    }

    const [u] = await this.db.select({ createdAt: users.createdAt }).from(users).where(eq(users.id, row.userId));
    const hours = await this.settings.get('listings.new_user_manual_moderation_hours');
    if (u && Date.now() - u.createdAt.getTime() < hours * 3_600_000) flags.push('new_user');

    const [dup] = await this.db
      .select({ n: count() })
      .from(listings)
      .where(and(eq(listings.userId, row.userId), eq(listings.title, row.title), eq(listings.categoryId, row.categoryId), eq(listings.status, 'active'), ne(listings.id, row.id)));
    if (dup.n > 0) return { decision: 'reject', flags: ['duplicate'], reason: 'У вас уже есть активное объявление с таким названием в этой категории' };

    const [blocked] = await this.db
      .select({ n: count() })
      .from(listingStatusHistory)
      .innerJoin(listings, eq(listings.id, listingStatusHistory.listingId))
      .where(and(eq(listings.userId, row.userId), eq(listingStatusHistory.toStatus, 'blocked'), gte(listingStatusHistory.createdAt, addDays(new Date(), -30))));
    if (blocked.n > 0) flags.push('recent_blocks');

    // Новый пользователь без других признаков риска публикуется сразу: флаг только информационный.
    const blocking = flags.filter((f) => f !== 'new_user');
    if (blocking.length || (flags.includes('new_user') && flags.length > 1)) return { decision: 'manual', flags, reason: null };
    return { decision: 'approve', flags, reason: null };
  }

  async record(listingId: string, r: AutoModerationResult) {
    await this.db.insert(moderationDecisions).values({ listingId, automatic: true, decision: r.decision, reason: r.reason, flags: r.flags });
  }
}
