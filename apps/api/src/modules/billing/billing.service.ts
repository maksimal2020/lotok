import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { and, asc, count, desc, eq, gt, inArray, lte, sql } from 'drizzle-orm';
import Redis from 'ioredis';
import type { PaidServiceDto, PaidServiceInput, PurchaseDto } from '@lotok/shared';
import { DB, type Db, type DbOrTx } from '../../database/database.module';
import { listingPromotions, listings, paidServices, payments, purchases, userSubscriptions } from '../../database/schema';
import { REDIS } from '../../infra/redis.module';
import { JobsService } from '../../infra/jobs.service';
import { track } from '../../infra/metrics';
import { Errors } from '../../common/errors';
import { addDays, paginate } from '../../common/util';
import { CategoriesService } from '../catalog/categories.service';
import { ListingsService } from '../listings/listings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { LedgerService } from '../payments/ledger.service';
import { PaymentsService } from '../payments/payments.service';

type ServiceRow = typeof paidServices.$inferSelect;
type PurchaseRow = typeof purchases.$inferSelect;

const toServiceDto = (s: ServiceRow): PaidServiceDto => ({
  id: s.id,
  code: s.code,
  type: s.type,
  name: s.name,
  description: s.description,
  price: s.price,
  durationDays: s.durationDays,
  quantity: s.quantity,
  categoryId: s.categoryId,
  isActive: s.isActive,
  bonusAllowed: s.bonusAllowed,
  sort: s.sort,
});

const PROMO_TYPES = ['bump', 'highlight', 'premium'] as const;

/**
 * Монетизация: каталог платных услуг (цены и сроки — из админки), покупки, активация эффектов.
 * Выручка проводится по счёту platform_revenue; бонусы — отдельный неденежный счёт.
 */
@Injectable()
export class BillingService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly payments: PaymentsService,
    private readonly ledger: LedgerService,
    private readonly listings: ListingsService,
    private readonly categories: CategoriesService,
    private readonly notifications: NotificationsService,
    private readonly jobs: JobsService,
  ) {}

  onModuleInit() {
    this.payments.registerHooks('service', {
      succeeded: (tx, p) => this.onPaid(tx, p),
      canceled: async (tx, p) => {
        await tx.update(purchases).set({ status: 'canceled', updatedAt: new Date() }).where(and(eq(purchases.id, p.purchaseId!), eq(purchases.status, 'pending_payment')));
      },
      refunded: (tx, p, amount, refundId) => this.onRefunded(tx, p, amount, refundId),
    });
    this.jobs.register('promotions.daily-bump', () => this.dailyBump());
    this.jobs.register('promotions.expire', () => this.reindexExpiredPromotions());
  }

  async catalog(opts: { listingId?: string; userId?: string } = {}): Promise<PaidServiceDto[]> {
    const rows = await this.db.select().from(paidServices).where(eq(paidServices.isActive, true)).orderBy(asc(paidServices.sort), asc(paidServices.price));
    if (!opts.listingId) return rows.map(toServiceDto);
    const l = await this.listings.getRow(opts.listingId);
    const path = (await this.categories.path(l.categoryId)).map((p) => p.id);
    return rows.filter((s) => s.categoryId === null || path.includes(s.categoryId)).map(toServiceDto);
  }

  async purchase(userId: string, input: { serviceCode: string; listingId?: string; useBonus: boolean }, idemKey: string | null): Promise<PurchaseDto> {
    if (idemKey) {
      const existing = await this.redis.get(`idem:purchase:${userId}:${idemKey}`);
      if (existing) return this.getPurchase(userId, existing);
    }
    const [service] = await this.db.select().from(paidServices).where(and(eq(paidServices.code, input.serviceCode), eq(paidServices.isActive, true)));
    if (!service) throw Errors.notFound('Услуга');
    const needsListing = (PROMO_TYPES as readonly string[]).includes(service.type);
    if (needsListing) {
      if (!input.listingId) throw Errors.badRequest('listing_required', 'Выберите объявление для продвижения');
      const l = await this.listings.getOwned(userId, input.listingId);
      if (l.status !== 'active') throw Errors.conflict('listing_not_active', 'Продвигать можно только опубликованное объявление');
      if (service.categoryId) {
        const path = (await this.categories.path(l.categoryId)).map((p) => p.id);
        if (!path.includes(service.categoryId)) throw Errors.badRequest('service_category_mismatch', 'Услуга недоступна для этой категории');
      }
    }
    const bonus = input.useBonus && service.bonusAllowed ? Math.min(await this.ledger.balance('user_bonus', userId), service.price) : 0;
    const toPay = service.price - bonus;

    const purchase = await this.db.transaction(async (tx) => {
      const [p] = await tx
        .insert(purchases)
        .values({ userId, serviceId: service.id, listingId: needsListing ? input.listingId! : null, price: service.price, paidWithBonus: bonus, status: 'pending_payment' })
        .returning();
      if (bonus > 0) {
        await this.ledger.post(tx, {
          kind: 'bonus_spend',
          description: `Оплата бонусами: ${service.name}`,
          idempotencyKey: `purchase:${p.id}:bonus`,
          purchaseId: p.id,
          entries: [
            { account: 'user_bonus', userId, amount: -bonus },
            { account: 'bonus_issued', amount: bonus },
          ],
        });
      }
      if (toPay === 0) await this.activate(tx, p.id);
      else {
        await this.payments.create(tx, {
          userId,
          purpose: 'service',
          purchaseId: p.id,
          amount: toPay,
          description: service.name,
          idempotencyKey: `purchase:${p.id}`,
          returnPath: `/payments?purchase=${p.id}`,
          receiptItems: [{ description: service.name, quantity: 1, amount: toPay, vatCode: 1, paymentSubject: 'service' }],
        });
      }
      return p;
    });
    if (idemKey) await this.redis.set(`idem:purchase:${userId}:${idemKey}`, purchase.id, 'EX', 86400);
    if (toPay > 0) {
      const [pay] = await this.db.select().from(payments).where(eq(payments.purchaseId, purchase.id));
      await this.payments.register(pay.id, `/payments?purchase=${purchase.id}`);
    }
    track('purchase_created');
    return this.getPurchase(userId, purchase.id);
  }

  private async onPaid(tx: DbOrTx, p: typeof payments.$inferSelect) {
    await this.ledger.post(tx, {
      kind: 'service_payment',
      description: p.description,
      idempotencyKey: `payment:${p.id}:succeeded`,
      paymentId: p.id,
      purchaseId: p.purchaseId,
      entries: [
        { account: 'provider_clearing', amount: p.amount },
        { account: 'platform_revenue', amount: -p.amount },
      ],
    });
    await this.activate(tx, p.purchaseId!);
  }

  /** Применение эффекта услуги. Повторный вызов для активной покупки ничего не меняет. */
  async activate(tx: DbOrTx, purchaseId: string) {
    const [p] = await tx.select().from(purchases).where(eq(purchases.id, purchaseId)).for('update');
    if (!p || p.status !== 'pending_payment') return;
    const [s] = await tx.select().from(paidServices).where(eq(paidServices.id, p.serviceId));
    const now = new Date();
    const endsAt = s.durationDays ? addDays(now, s.durationDays) : null;
    let status: PurchaseRow['status'] = 'active';
    switch (s.type) {
      case 'bump':
        await tx.update(listings).set({ bumpedAt: now }).where(eq(listings.id, p.listingId!));
        if (s.durationDays && s.durationDays > 1) {
          await tx.insert(listingPromotions).values({ listingId: p.listingId!, purchaseId: p.id, type: 'bump', startsAt: now, endsAt: endsAt! });
        } else status = 'consumed';
        break;
      case 'highlight':
      case 'premium':
        await tx.insert(listingPromotions).values({ listingId: p.listingId!, purchaseId: p.id, type: s.type, startsAt: now, endsAt: endsAt ?? addDays(now, 7) });
        if (s.type === 'premium') await tx.update(listings).set({ bumpedAt: now }).where(eq(listings.id, p.listingId!));
        break;
      case 'listing_slot':
      case 'listing_package':
        break;
      case 'pro_subscription':
      case 'analytics': {
        // Продление: новый период начинается после окончания текущего.
        const [cur] = await tx
          .select({ endsAt: userSubscriptions.endsAt })
          .from(userSubscriptions)
          .where(and(eq(userSubscriptions.userId, p.userId), eq(userSubscriptions.serviceType, s.type), gt(userSubscriptions.endsAt, now)))
          .orderBy(desc(userSubscriptions.endsAt))
          .limit(1);
        const start = cur?.endsAt ?? now;
        await tx.insert(userSubscriptions).values({ userId: p.userId, purchaseId: p.id, serviceType: s.type, startsAt: start, endsAt: addDays(start, s.durationDays ?? 30) });
        break;
      }
    }
    await tx
      .update(purchases)
      .set({
        status,
        startsAt: now,
        endsAt: s.type === 'listing_slot' ? null : endsAt,
        quantityRemaining: s.type === 'listing_slot' ? 1 : s.type === 'listing_package' ? (s.quantity ?? 1) : null,
        updatedAt: now,
      })
      .where(eq(purchases.id, p.id));
    const listingId = p.listingId;
    setImmediate(() => {
      if (listingId) void this.jobs.enqueue('search.index', { listingId });
      void this.notifications
        .notify(p.userId, { type: 'billing.activated', group: 'billing', title: 'Услуга подключена', body: `«${s.name}» активирована.`, data: { purchaseId: p.id } })
        .catch(() => undefined);
    });
  }

  private async onRefunded(tx: DbOrTx, p: typeof payments.$inferSelect, amount: number, refundId: string) {
    await this.ledger.post(tx, {
      kind: 'service_refund',
      description: `Возврат: ${p.description}`,
      idempotencyKey: `refund:${refundId}`,
      paymentId: p.id,
      purchaseId: p.purchaseId,
      entries: [
        { account: 'provider_clearing', amount: -amount },
        { account: 'platform_revenue', amount },
      ],
    });
    if (p.status === 'refunded') {
      const now = new Date();
      await tx.update(purchases).set({ status: 'refunded', endsAt: now, quantityRemaining: 0, updatedAt: now }).where(eq(purchases.id, p.purchaseId!));
      await tx.update(listingPromotions).set({ endsAt: now }).where(and(eq(listingPromotions.purchaseId, p.purchaseId!), gt(listingPromotions.endsAt, now)));
      await tx.update(userSubscriptions).set({ endsAt: now }).where(and(eq(userSubscriptions.purchaseId, p.purchaseId!), gt(userSubscriptions.endsAt, now)));
    }
  }

  async getPurchase(userId: string, id: string): Promise<PurchaseDto> {
    const [r] = await this.db
      .select({ p: purchases, s: paidServices })
      .from(purchases)
      .innerJoin(paidServices, eq(paidServices.id, purchases.serviceId))
      .where(and(eq(purchases.id, id), eq(purchases.userId, userId)));
    if (!r) throw Errors.notFound('Покупка');
    const [pay] = await this.db.select().from(payments).where(eq(payments.purchaseId, id)).orderBy(desc(payments.createdAt)).limit(1);
    return this.presentPurchase(r.p, r.s, pay);
  }

  private presentPurchase(p: PurchaseRow, s: ServiceRow, pay?: typeof payments.$inferSelect): PurchaseDto {
    return {
      id: p.id,
      service: { code: s.code, name: s.name, type: s.type },
      listingId: p.listingId,
      status: p.status,
      price: p.price,
      paidWithBonus: p.paidWithBonus,
      quantityRemaining: p.quantityRemaining,
      startsAt: p.startsAt?.toISOString() ?? null,
      endsAt: p.endsAt?.toISOString() ?? null,
      createdAt: p.createdAt.toISOString(),
      payment: pay ? { id: pay.id, status: pay.status, confirmationUrl: pay.status === 'pending' ? pay.confirmationUrl : null } : null,
    };
  }

  async listPurchases(userId: string, page: number, limit: number) {
    const { offset } = paginate(page, limit);
    const rows = await this.db
      .select({ p: purchases, s: paidServices })
      .from(purchases)
      .innerJoin(paidServices, eq(paidServices.id, purchases.serviceId))
      .where(eq(purchases.userId, userId))
      .orderBy(desc(purchases.createdAt))
      .limit(limit)
      .offset(offset);
    const [{ total }] = await this.db.select({ total: count() }).from(purchases).where(eq(purchases.userId, userId));
    const pays = rows.length ? await this.db.select().from(payments).where(inArray(payments.purchaseId, rows.map((r) => r.p.id))) : [];
    return { items: rows.map((r) => this.presentPurchase(r.p, r.s, pays.find((x) => x.purchaseId === r.p.id))), total, page, limit };
  }

  async quotas(userId: string) {
    const rows = await this.db
      .select({ p: purchases, s: paidServices })
      .from(purchases)
      .innerJoin(paidServices, eq(paidServices.id, purchases.serviceId))
      .where(and(eq(purchases.userId, userId), eq(purchases.status, 'active'), inArray(paidServices.type, ['listing_slot', 'listing_package'])));
    return rows.map((r) => ({ purchaseId: r.p.id, service: r.s.name, remaining: r.p.quantityRemaining, endsAt: r.p.endsAt?.toISOString() ?? null, categoryId: r.s.categoryId }));
  }

  /** Многодневное поднятие: раз в сутки объявление поднимается в выдаче по дате. */
  async dailyBump() {
    const now = new Date();
    const rows = await this.db
      .select({ listingId: listingPromotions.listingId })
      .from(listingPromotions)
      .innerJoin(listings, eq(listings.id, listingPromotions.listingId))
      .where(and(eq(listingPromotions.type, 'bump'), lte(listingPromotions.startsAt, now), gt(listingPromotions.endsAt, now), eq(listings.status, 'active'), sql`${listings.bumpedAt} < now() - interval '23 hours'`));
    for (const r of rows) {
      await this.db.update(listings).set({ bumpedAt: now }).where(eq(listings.id, r.listingId));
      await this.jobs.enqueue('search.index', { listingId: r.listingId });
    }
    return rows.length;
  }

  async reindexExpiredPromotions() {
    const rows = await this.db
      .select({ listingId: listingPromotions.listingId })
      .from(listingPromotions)
      .where(and(lte(listingPromotions.endsAt, new Date()), gt(listingPromotions.endsAt, new Date(Date.now() - 2 * 3600_000))));
    for (const r of rows) await this.jobs.enqueue('search.index', { listingId: r.listingId });
    return rows.length;
  }

  /* ------------------------------ admin ------------------------------ */

  async adminList() {
    return (await this.db.select().from(paidServices).orderBy(asc(paidServices.sort))).map(toServiceDto);
  }

  async upsertService(input: PaidServiceInput, id?: number) {
    const values = { ...input, durationDays: input.durationDays ?? null, quantity: input.quantity ?? null, categoryId: input.categoryId ?? null };
    if (id) {
      const [before] = await this.db.select().from(paidServices).where(eq(paidServices.id, id));
      if (!before) throw Errors.notFound('Услуга');
      const [after] = await this.db.update(paidServices).set({ ...values, updatedAt: new Date() }).where(eq(paidServices.id, id)).returning();
      return { before: toServiceDto(before), after: toServiceDto(after) };
    }
    const [after] = await this.db.insert(paidServices).values(values).returning();
    return { before: null, after: toServiceDto(after) };
  }
}
