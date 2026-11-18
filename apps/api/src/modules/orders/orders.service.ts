import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { and, asc, count, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import Redis from 'ioredis';
import {
  applyBasisPoints,
  findOrderTransition,
  LABELS,
  ORDER_TRANSITIONS,
  TERMINAL_ORDER_STATUSES,
  type CreateOrderInput,
  type OrderActor,
  type OrderDto,
  type OrderStatus,
} from '@lotok/shared';
import { DB, type Db, type DbOrTx } from '../../database/database.module';
import { listingMedia, listings, media, orderStatusHistory, orders, payments, reviews, shipments, userBlocks, users } from '../../database/schema';
import { REDIS } from '../../infra/redis.module';
import { JobsService } from '../../infra/jobs.service';
import { RealtimeService, SettingsService } from '../../infra/platform.services';
import { StorageService } from '../../infra/storage.service';
import { track } from '../../infra/metrics';
import { Errors } from '../../common/errors';
import { addDays, paginate, randomDigits } from '../../common/util';
import { mediaUrls } from '../media/media.presenter';
import { CategoriesService } from '../catalog/categories.service';
import { RegionsService } from '../catalog/regions.service';
import { ListingsService } from '../listings/listings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { LedgerService } from '../payments/ledger.service';
import { PaymentsService } from '../payments/payments.service';
import { DELIVERY_PROVIDERS, type DeliveryProvider } from './delivery';

type OrderRow = typeof orders.$inferSelect;

const ACTION_TARGET: Record<string, OrderStatus> = {
  confirm: 'confirmed',
  ship: 'shipped',
  deliver: 'delivered',
  complete: 'completed',
  cancel: 'canceled',
  request_refund: 'refund_requested',
  approve_refund: 'refunded',
  reject_refund: 'completed',
};

/**
 * Заказы. Оплата онлайн проходит через платёжного провайдера (в разработке — тестовый),
 * средства продавца учитываются на счёте seller_payable. Выплаты продавцам платформой не выполняются:
 * для production требуется провайдер со сплитованием/выплатами (см. docs/LEGAL.md, docs/DECISIONS.md).
 */
@Injectable()
export class OrdersService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(DELIVERY_PROVIDERS) private readonly delivery: DeliveryProvider[],
    private readonly listings: ListingsService,
    private readonly categories: CategoriesService,
    private readonly regions: RegionsService,
    private readonly payments: PaymentsService,
    private readonly ledger: LedgerService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
    private readonly settings: SettingsService,
    private readonly jobs: JobsService,
    private readonly storage: StorageService,
  ) {}

  onModuleInit() {
    this.payments.registerHooks('order', {
      succeeded: (tx, p) => this.onPaid(tx, p),
      canceled: (tx, p) => this.onPaymentCanceled(tx, p),
      refunded: (tx, p, amount, refundId) => this.onRefunded(tx, p, amount, refundId),
    });
    this.jobs.register('orders.auto-complete', () => this.autoComplete());
    this.jobs.register('orders.cancel-unpaid', () => this.cancelUnpaid());
  }

  private provider(code?: string) {
    const p = this.delivery.find((d) => d.code === (code ?? this.delivery[0].code));
    if (!p) throw Errors.badRequest('unknown_delivery_provider', 'Служба доставки не поддерживается');
    return p;
  }

  async quote(listingId: string, toCity: string) {
    const listing = await this.listings.getRow(listingId);
    if (!listing.deliveryAvailable) throw Errors.badRequest('delivery_unavailable', 'Продавец не отправляет этот товар');
    const city = await this.regions.get(listing.cityId);
    return Promise.all(this.delivery.map((d) => d.quote(city.name, toCity, 1000)));
  }

  async create(buyerId: string, input: CreateOrderInput, idemKey: string | null): Promise<OrderDto> {
    if (idemKey) {
      const existing = await this.redis.get(`idem:order:${buyerId}:${idemKey}`);
      if (existing) return this.get(buyerId, existing, false);
    }
    const listing = await this.listings.getRow(input.listingId);
    const category = await this.categories.get(listing.categoryId);
    if (listing.status !== 'active') throw Errors.conflict('listing_unavailable', 'Объявление недоступно для покупки');
    if (listing.userId === buyerId) throw Errors.badRequest('own_listing', 'Нельзя купить свой товар');
    if (category.vertical !== 'goods' || listing.price === null || listing.price <= 0 || !['fixed', 'negotiable'].includes(listing.priceType)) {
      throw Errors.badRequest('not_purchasable', 'Этот товар нельзя купить онлайн');
    }
    if (input.deliveryMethod === 'delivery' && !listing.deliveryAvailable) throw Errors.badRequest('delivery_unavailable', 'Продавец не отправляет этот товар');
    const [blocked] = await this.db
      .select({ n: count() })
      .from(userBlocks)
      .where(or(and(eq(userBlocks.blockerId, listing.userId), eq(userBlocks.blockedId, buyerId)), and(eq(userBlocks.blockerId, buyerId), eq(userBlocks.blockedId, listing.userId))));
    if (blocked.n) throw Errors.forbidden('Сделка с этим продавцом недоступна', 'blocked');
    const [buyer] = await this.db.select().from(users).where(eq(users.id, buyerId));
    if (!buyer.emailVerifiedAt && !buyer.phoneVerifiedAt) throw Errors.forbidden('Подтвердите email или телефон, чтобы оформить заказ', 'contact_not_verified');

    let deliveryPrice = 0;
    let deliveryProvider: string | null = null;
    if (input.deliveryMethod === 'delivery') {
      const p = this.provider(input.deliveryProvider);
      const city = await this.regions.get(listing.cityId);
      const q = await p.quote(city.name, input.deliveryAddress!.city, 1000);
      deliveryPrice = q.price;
      deliveryProvider = p.code;
    }
    const commissionBp = input.payOnline ? await this.settings.get('orders.commission_bp') : 0;
    const itemTotal = listing.price * input.quantity;
    const commission = applyBasisPoints(itemTotal, commissionBp);

    const order = await this.db.transaction(async (tx) => {
      // Резерв количества под блокировкой строки — защита от продажи одного товара двум покупателям.
      const [l] = await tx.select().from(listings).where(eq(listings.id, listing.id)).for('update');
      if (l.status !== 'active') throw Errors.conflict('listing_unavailable', 'Объявление недоступно для покупки');
      if (l.quantity < input.quantity) throw Errors.conflict('out_of_stock', 'Товар уже зарезервирован другим покупателем');
      if (l.price !== listing.price) throw Errors.conflict('price_changed', 'Цена изменилась, обновите страницу');
      await tx.update(listings).set({ quantity: l.quantity - input.quantity, updatedAt: new Date() }).where(eq(listings.id, l.id));
      const status: OrderStatus = input.payOnline ? 'pending_payment' : 'created';
      const [o] = await tx
        .insert(orders)
        .values({
          number: `${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${randomDigits(6)}`,
          buyerId,
          sellerId: l.userId,
          listingId: l.id,
          listingTitle: l.title,
          quantity: input.quantity,
          itemPrice: l.price!,
          deliveryPrice,
          commission,
          total: itemTotal + deliveryPrice,
          status,
          paymentStatus: input.payOnline ? 'pending' : 'not_required',
          deliveryMethod: input.deliveryMethod,
          deliveryProvider,
          deliveryAddress: input.deliveryAddress ?? null,
          comment: input.comment ?? null,
        })
        .returning();
      await tx.insert(orderStatusHistory).values({ orderId: o.id, fromStatus: null, toStatus: status, actorId: buyerId, actorType: 'buyer' });
      if (input.payOnline) {
        await this.payments.create(tx, {
          userId: buyerId,
          purpose: 'order',
          orderId: o.id,
          amount: o.total,
          description: `Заказ ${o.number}: ${l.title}`,
          idempotencyKey: `order:${o.id}`,
          returnPath: `/orders/${o.id}`,
          receiptItems: [
            { description: l.title, quantity: input.quantity, amount: l.price!, vatCode: 1, paymentSubject: 'commodity' },
            ...(deliveryPrice ? [{ description: 'Доставка', quantity: 1, amount: deliveryPrice, vatCode: 1, paymentSubject: 'service' as const }] : []),
          ],
        });
      }
      return o;
    });
    if (idemKey) await this.redis.set(`idem:order:${buyerId}:${idemKey}`, order.id, 'EX', 86400);
    track('order_created');
    if (input.payOnline) {
      const [p] = await this.db.select().from(payments).where(eq(payments.orderId, order.id));
      try {
        await this.payments.register(p.id, `/orders/${order.id}`);
      } catch (e) {
        await this.transition(order.id, 'canceled', 'system', null, 'Платёжный сервис недоступен');
        throw e;
      }
    } else {
      await this.notifySeller(order, 'Новый заказ', `Покупатель оформил заказ ${order.number} на «${order.listingTitle}» (самовывоз). Подтвердите его.`);
    }
    return this.get(buyerId, order.id, false);
  }

  private async notifySeller(o: OrderRow, title: string, body: string) {
    await this.notifications.notify(o.sellerId, { type: 'order.updated', group: 'orders', title, body, data: { orderId: o.id } });
  }

  /* ---------------------------- платёжные hooks ---------------------------- */

  private async onPaid(tx: DbOrTx, p: typeof payments.$inferSelect) {
    const [o] = await tx.select().from(orders).where(eq(orders.id, p.orderId!)).for('update');
    if (!o) return;
    await this.ledger.post(tx, {
      kind: 'order_payment',
      description: `Оплата заказа ${o.number}`,
      idempotencyKey: `payment:${p.id}:succeeded`,
      paymentId: p.id,
      orderId: o.id,
      entries: [
        { account: 'provider_clearing', amount: p.amount },
        { account: 'seller_payable', userId: o.sellerId, amount: -(p.amount - o.commission) },
        { account: 'platform_revenue', amount: -o.commission },
      ],
    });
    if (o.status === 'pending_payment') {
      await tx.update(orders).set({ paymentStatus: 'paid', updatedAt: new Date() }).where(eq(orders.id, o.id));
      await this.transition(o.id, 'created', 'system', null, 'Оплачено', tx);
    } else {
      // Оплата пришла после отмены заказа (гонка с таймаутом) — деньги возвращаются автоматически.
      await tx.update(orders).set({ paymentStatus: 'paid', updatedAt: new Date() }).where(eq(orders.id, o.id));
      setImmediate(() => void this.payments.refund(p.id, undefined, 'Заказ отменён до поступления оплаты', null, `late:${p.id}`).catch(() => undefined));
    }
  }

  private async onPaymentCanceled(tx: DbOrTx, p: typeof payments.$inferSelect) {
    const [o] = await tx.select().from(orders).where(eq(orders.id, p.orderId!));
    if (o?.status === 'pending_payment') await this.transition(o.id, 'canceled', 'system', null, 'Оплата не завершена', tx);
  }

  private async onRefunded(tx: DbOrTx, p: typeof payments.$inferSelect, amount: number, refundId: string) {
    const [o] = await tx.select().from(orders).where(eq(orders.id, p.orderId!)).for('update');
    if (!o) return;
    const commissionPart = Math.floor((o.commission * amount) / p.amount);
    await this.ledger.post(tx, {
      kind: 'order_refund',
      description: `Возврат по заказу ${o.number}`,
      idempotencyKey: `refund:${refundId}`,
      paymentId: p.id,
      orderId: o.id,
      entries: [
        { account: 'provider_clearing', amount: -amount },
        { account: 'seller_payable', userId: o.sellerId, amount: amount - commissionPart },
        { account: 'platform_revenue', amount: commissionPart },
      ],
    });
    await tx
      .update(orders)
      .set({ paymentStatus: p.status === 'refunded' ? 'refunded' : 'refund_pending', updatedAt: new Date() })
      .where(eq(orders.id, o.id));
  }

  /* ---------------------------- переходы ---------------------------- */

  async transition(orderId: string, to: OrderStatus, actor: OrderActor, actorId: string | null, reason: string | null, txIn?: DbOrTx, version?: number) {
    const run = async (tx: DbOrTx) => {
      const [o] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
      if (!o) throw Errors.notFound('Заказ');
      if (version !== undefined && o.version !== version) throw Errors.versionConflict();
      if (!findOrderTransition(o.status, to, actor)) throw Errors.invalidTransition(o.status, to);
      const patch: Partial<typeof orders.$inferInsert> = { status: to, version: o.version + 1, updatedAt: new Date() };
      if (to === 'completed') patch.completedAt = new Date();
      if (to === 'canceled') patch.cancelReason = reason;
      await tx.update(orders).set(patch).where(eq(orders.id, orderId));
      await tx.insert(orderStatusHistory).values({ orderId, fromStatus: o.status, toStatus: to, actorId, actorType: actor, reason });
      // Отмена и возврат освобождают резерв товара.
      if (to === 'canceled' || to === 'refunded') {
        await tx
          .update(listings)
          .set({ quantity: sql`${listings.quantity} + ${o.quantity}` })
          .where(eq(listings.id, o.listingId));
        if (o.paymentStatus === 'pending') {
          const [p] = await tx.select().from(payments).where(eq(payments.orderId, o.id));
          if (p) await this.payments.cancelPending(tx, p.id);
          await tx.update(orders).set({ paymentStatus: 'not_required' }).where(eq(orders.id, o.id));
        }
      }
      return o;
    };
    const before = txIn ? await run(txIn) : await this.db.transaction(run);
    const after = { ...before, status: to };
    const postCommit = async () => {
      // Отмена оплаченного заказа — автоматический полный возврат.
      if ((to === 'canceled' || to === 'refunded') && before.paymentStatus === 'paid') {
        const [p] = await this.db.select().from(payments).where(eq(payments.orderId, orderId));
        if (p) await this.payments.refund(p.id, undefined, to === 'refunded' ? 'Возврат по заказу' : `Отмена заказа: ${reason ?? ''}`, actorId, `order-refund:${orderId}`);
      }
      if (to === 'completed') {
        const [l] = await this.db.select().from(listings).where(eq(listings.id, before.listingId));
        if (l && l.quantity === 0 && l.status === 'active') await this.listings.transition(l.id, 'sold', 'system', { reason: `Заказ ${before.number}` });
      }
      await this.notifyTransition(after as OrderRow, to, actor);
    };
    if (txIn) setImmediate(() => void postCommit().catch(() => undefined));
    else await postCommit();
    return after;
  }

  private async notifyTransition(o: OrderRow, to: OrderStatus, actor: OrderActor) {
    const label = LABELS.orderStatus[to];
    const payload = { orderId: o.id, status: to };
    this.realtime.toUsers([o.buyerId, o.sellerId], 'order:updated', payload);
    const targets: string[] = [];
    if (actor !== 'buyer') targets.push(o.buyerId);
    if (actor !== 'seller') targets.push(o.sellerId);
    for (const uid of targets) {
      await this.notifications.notify(uid, {
        type: 'order.updated',
        group: 'orders',
        title: `Заказ ${o.number}: ${label.toLowerCase()}`,
        body: `«${o.listingTitle}» — ${label}.`,
        data: payload,
      });
    }
  }

  async action(userId: string, orderId: string, action: string, body: { reason?: string; trackingNumber?: string }, staff = false) {
    const target = ACTION_TARGET[action];
    if (!target) throw Errors.badRequest('unknown_action', 'Неизвестное действие');
    const [o] = await this.db.select().from(orders).where(eq(orders.id, orderId));
    if (!o) throw Errors.notFound('Заказ');
    let actor: OrderActor;
    if (staff) actor = 'support';
    else if (o.buyerId === userId) actor = 'buyer';
    else if (o.sellerId === userId) actor = 'seller';
    else throw Errors.notFound('Заказ');
    if (action === 'reject_refund' && o.status !== 'refund_requested') throw Errors.invalidTransition(o.status, target);
    if (action === 'complete' && o.status === 'confirmed' && o.deliveryMethod === 'delivery') throw Errors.invalidTransition(o.status, target);
    if (action === 'ship') {
      if (o.deliveryMethod !== 'delivery') throw Errors.badRequest('pickup_order', 'Для самовывоза отправка не требуется');
      const p = this.provider(o.deliveryProvider ?? undefined);
      const listing = await this.listings.getRow(o.listingId);
      const city = await this.regions.get(listing.cityId);
      const shipment = body.trackingNumber
        ? { providerShipmentId: null, trackingNumber: body.trackingNumber, status: 'created' }
        : await p.createShipment({ orderId: o.id, fromCity: city.name, toCity: String((o.deliveryAddress as { city?: string })?.city ?? ''), address: o.deliveryAddress ?? {} });
      await this.db
        .insert(shipments)
        .values({ orderId: o.id, provider: p.code, providerShipmentId: shipment.providerShipmentId, trackingNumber: shipment.trackingNumber, status: 'created' })
        .onConflictDoUpdate({ target: shipments.orderId, set: { trackingNumber: shipment.trackingNumber, updatedAt: new Date() } });
      await this.db.update(orders).set({ trackingNumber: shipment.trackingNumber }).where(eq(orders.id, o.id));
    }
    await this.transition(orderId, target, actor, userId, body.reason ?? null);
    return this.get(userId, orderId, staff);
  }

  availableActions(o: OrderRow, role: 'buyer' | 'seller' | 'staff'): string[] {
    const actor: OrderActor = role === 'staff' ? 'support' : role;
    return ORDER_TRANSITIONS.filter((t) => t.from === o.status && t.actors.includes(actor))
      .map((t) => t.action)
      .filter((a) => a !== 'payment_succeeded')
      .filter((a) => !(a === 'ship' && o.deliveryMethod === 'pickup'))
      .filter((a) => !(a === 'complete' && o.status === 'confirmed' && o.deliveryMethod === 'delivery'));
  }

  async get(userId: string, orderId: string, staff: boolean): Promise<OrderDto> {
    const [o] = await this.db.select().from(orders).where(eq(orders.id, orderId));
    if (!o || (!staff && o.buyerId !== userId && o.sellerId !== userId)) throw Errors.notFound('Заказ');
    return (await this.present([o], userId, staff))[0];
  }

  async list(userId: string, role: 'buyer' | 'seller', page: number, limit: number, status?: OrderStatus) {
    const { offset } = paginate(page, limit);
    const cond = and(role === 'buyer' ? eq(orders.buyerId, userId) : eq(orders.sellerId, userId), status ? eq(orders.status, status) : undefined);
    const [rows, [{ total }]] = await Promise.all([
      this.db.select().from(orders).where(cond).orderBy(desc(orders.createdAt)).limit(limit).offset(offset),
      this.db.select({ total: count() }).from(orders).where(cond),
    ]);
    return { items: await this.present(rows, userId, false), total, page, limit };
  }

  async listAll(page: number, limit: number, status?: OrderStatus) {
    const { offset } = paginate(page, limit);
    const cond = status ? eq(orders.status, status) : undefined;
    const [rows, [{ total }]] = await Promise.all([
      this.db.select().from(orders).where(cond).orderBy(desc(orders.createdAt)).limit(limit).offset(offset),
      this.db.select({ total: count() }).from(orders).where(cond),
    ]);
    return { items: await this.present(rows, '', true), total, page, limit };
  }

  private async present(rows: OrderRow[], userId: string, staff: boolean): Promise<OrderDto[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const userIds = [...new Set(rows.flatMap((r) => [r.buyerId, r.sellerId]))];
    const [people, history, pays, photos, myReviews] = await Promise.all([
      this.db.select({ id: users.id, displayName: users.displayName }).from(users).where(inArray(users.id, userIds)),
      this.db.select().from(orderStatusHistory).where(inArray(orderStatusHistory.orderId, ids)).orderBy(asc(orderStatusHistory.createdAt)),
      this.db.select().from(payments).where(inArray(payments.orderId, ids)).orderBy(desc(payments.createdAt)),
      this.db
        .select({ listingId: listingMedia.listingId, variants: media.variants, status: media.status })
        .from(listingMedia)
        .innerJoin(media, eq(media.id, listingMedia.mediaId))
        .where(and(inArray(listingMedia.listingId, rows.map((r) => r.listingId)), eq(listingMedia.position, 0))),
      userId ? this.db.select({ orderId: reviews.orderId }).from(reviews).where(and(eq(reviews.authorId, userId), inArray(reviews.orderId, ids))) : Promise.resolve([]),
    ]);
    return rows.map((o) => {
      const role: OrderDto['role'] = staff ? 'staff' : o.buyerId === userId ? 'buyer' : 'seller';
      const p = pays.find((x) => x.orderId === o.id);
      const photo = photos.find((x) => x.listingId === o.listingId);
      return {
        id: o.id,
        number: o.number,
        status: o.status,
        paymentStatus: o.paymentStatus,
        role,
        listing: { id: o.listingId, title: o.listingTitle, photo: photo ? mediaUrls(this.storage, photo) : null },
        buyer: { id: o.buyerId, displayName: people.find((x) => x.id === o.buyerId)?.displayName ?? '' },
        seller: { id: o.sellerId, displayName: people.find((x) => x.id === o.sellerId)?.displayName ?? '' },
        quantity: o.quantity,
        itemPrice: o.itemPrice,
        deliveryPrice: o.deliveryPrice,
        total: o.total,
        currency: o.currency,
        deliveryMethod: o.deliveryMethod,
        deliveryProvider: o.deliveryProvider,
        // Адрес и телефон получателя видят только участники сделки.
        deliveryAddress: o.deliveryAddress,
        trackingNumber: o.trackingNumber,
        comment: o.comment,
        createdAt: o.createdAt.toISOString(),
        updatedAt: o.updatedAt.toISOString(),
        availableActions: this.availableActions(o, role),
        canReview: role !== 'staff' && o.status === 'completed' && !myReviews.some((r) => r.orderId === o.id),
        history: history.filter((h) => h.orderId === o.id).map((h) => ({ status: h.toStatus, at: h.createdAt.toISOString(), actor: h.actorType, reason: h.reason })),
        payment: p ? { id: p.id, status: p.status, confirmationUrl: p.status === 'pending' ? p.confirmationUrl : null, testMode: p.testMode } : null,
        version: o.version,
        ...(role === 'seller' ? { commission: o.commission } : {}),
      };
    });
  }

  /* ---------------------------- периодические задания ---------------------------- */

  async autoComplete() {
    const days = await this.settings.get('orders.auto_complete_days');
    const rows = await this.db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.status, 'delivered'), lt(orders.updatedAt, addDays(new Date(), -days))))
      .limit(500);
    for (const r of rows) await this.transition(r.id, 'completed', 'system', null, 'Автоматическое завершение').catch(() => undefined);
    return rows.length;
  }

  async cancelUnpaid() {
    const minutes = await this.settings.get('orders.unpaid_cancel_minutes');
    const rows = await this.db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.status, 'pending_payment'), lt(orders.createdAt, new Date(Date.now() - minutes * 60_000))))
      .limit(500);
    for (const r of rows) await this.transition(r.id, 'canceled', 'system', null, 'Заказ не оплачен вовремя').catch(() => undefined);
    return rows.length;
  }

  isTerminal(s: OrderStatus) {
    return TERMINAL_ORDER_STATUSES.includes(s);
  }
}
