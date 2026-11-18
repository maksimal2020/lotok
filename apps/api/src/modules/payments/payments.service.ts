import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { and, count, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import type { PaymentDto, PaymentPurpose, PaymentStatus } from '@lotok/shared';
import { CONFIG, type AppConfig } from '../../config/config';
import { DB, type Db, type DbOrTx } from '../../database/database.module';
import { paymentEvents, payments, refunds, users } from '../../database/schema';
import { JobsService } from '../../infra/jobs.service';
import { SecurityEventsService } from '../../infra/platform.services';
import { track } from '../../infra/metrics';
import { AppError, Errors } from '../../common/errors';
import { paginate } from '../../common/util';
import { MockPaymentProvider } from './providers/mock.provider';
import { PAYMENT_PROVIDER, type CreatePaymentRequest, type PaymentProvider } from './providers/payment-provider';

type PaymentRow = typeof payments.$inferSelect;

export interface PaymentHooks {
  /** Вызывается в транзакции при успешной оплате. */
  succeeded(tx: DbOrTx, payment: PaymentRow): Promise<void>;
  canceled(tx: DbOrTx, payment: PaymentRow): Promise<void>;
  refunded(tx: DbOrTx, payment: PaymentRow, amount: number, refundId: string): Promise<void>;
}

const ALLOWED: Record<PaymentStatus, PaymentStatus[]> = {
  pending: ['waiting_for_capture', 'succeeded', 'canceled'],
  waiting_for_capture: ['succeeded', 'canceled'],
  succeeded: ['partially_refunded', 'refunded'],
  partially_refunded: ['partially_refunded', 'refunded'],
  canceled: [],
  refunded: [],
};

export function presentPayment(p: PaymentRow): PaymentDto {
  return {
    id: p.id,
    purpose: p.purpose,
    provider: p.provider,
    amount: p.amount,
    refundedAmount: p.refundedAmount,
    currency: p.currency,
    status: p.status,
    description: p.description,
    confirmationUrl: p.status === 'pending' ? p.confirmationUrl : null,
    testMode: p.testMode,
    orderId: p.orderId,
    purchaseId: p.purchaseId,
    createdAt: p.createdAt.toISOString(),
  };
}

/**
 * Платежи: создание через провайдера, обработка webhook (идемпотентно, с проверкой подлинности),
 * синхронизация статуса, возвраты. Бизнес-последствия (заказ/услуга) — через зарегистрированные hooks.
 */
@Injectable()
export class PaymentsService implements OnModuleInit {
  private readonly logger = new Logger('Payments');
  private readonly hooks = new Map<PaymentPurpose, PaymentHooks>();

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(PAYMENT_PROVIDER) readonly provider: PaymentProvider,
    private readonly jobs: JobsService,
    private readonly security: SecurityEventsService,
  ) {}

  onModuleInit() {
    this.jobs.register('payments.mock-webhook', async (d: { body: string; signature: string }) => {
      await this.handleWebhook(Buffer.from(d.body), { 'x-mock-signature': d.signature }, null);
    });
    this.jobs.register('payments.reconcile', () => this.reconcilePending());
  }

  registerHooks(purpose: PaymentPurpose, hooks: PaymentHooks) {
    this.hooks.set(purpose, hooks);
  }

  async create(
    tx: DbOrTx,
    input: {
      userId: string;
      purpose: PaymentPurpose;
      orderId?: string;
      purchaseId?: string;
      amount: number;
      description: string;
      idempotencyKey: string;
      returnPath: string;
      receiptItems?: CreatePaymentRequest['receiptItems'];
    },
  ): Promise<PaymentRow> {
    const [existing] = await tx
      .select()
      .from(payments)
      .where(and(eq(payments.userId, input.userId), eq(payments.idempotencyKey, input.idempotencyKey)));
    if (existing) return existing;
    const [row] = await tx
      .insert(payments)
      .values({
        userId: input.userId,
        purpose: input.purpose,
        orderId: input.orderId ?? null,
        purchaseId: input.purchaseId ?? null,
        provider: this.provider.name,
        amount: input.amount,
        description: input.description.slice(0, 250),
        idempotencyKey: input.idempotencyKey,
        testMode: this.provider.testMode,
        status: 'pending',
        metadata: input.receiptItems ? { receiptItems: input.receiptItems } : {},
      })
      .returning();
    return row;
  }

  /** Регистрация платежа у провайдера (вне транзакции БД — внешний вызов). */
  async register(paymentId: string, returnPath: string): Promise<PaymentRow> {
    const [p] = await this.db.select().from(payments).where(eq(payments.id, paymentId));
    if (!p) throw Errors.notFound('Платёж');
    if (p.providerPaymentId) return p;
    const [u] = await this.db.select({ email: users.email, phone: users.phone }).from(users).where(eq(users.id, p.userId));
    try {
      const r = await this.provider.create({
        paymentId: p.id,
        amount: p.amount,
        currency: p.currency,
        description: p.description,
        returnUrl: `${this.config.WEB_URL}${returnPath}`,
        idempotencyKey: `pay:${p.id}`,
        metadata: { purpose: p.purpose, ...(p.orderId ? { orderId: p.orderId } : {}), ...(p.purchaseId ? { purchaseId: p.purchaseId } : {}) },
        customerEmail: u?.email,
        customerPhone: u?.phone,
        receiptItems: (p.metadata as { receiptItems?: CreatePaymentRequest['receiptItems'] }).receiptItems,
      });
      const [updated] = await this.db
        .update(payments)
        .set({ providerPaymentId: r.providerPaymentId, confirmationUrl: r.confirmationUrl, updatedAt: new Date() })
        .where(eq(payments.id, p.id))
        .returning();
      track('payment_created');
      return updated;
    } catch (e) {
      this.logger.error({ err: e, paymentId }, 'Provider create failed');
      throw new AppError(502, 'payment_provider_error', 'Платёжный сервис временно недоступен. Повторите попытку позже.');
    }
  }

  async handleWebhook(raw: Buffer, headers: Record<string, string | string[] | undefined>, ip: string | null) {
    const ev = await this.provider.parseWebhook(raw, headers, ip);
    const [p] = ev.providerPaymentId
      ? await this.db
          .select()
          .from(payments)
          .where(and(eq(payments.provider, this.provider.name), eq(payments.providerPaymentId, ev.providerPaymentId)))
      : [];
    const inserted = await this.db
      .insert(paymentEvents)
      .values({
        paymentId: p?.id ?? null,
        provider: this.provider.name,
        providerEventId: ev.eventId,
        eventType: ev.eventType,
        payload: ev.payload,
        signatureValid: ev.signatureValid,
      })
      .onConflictDoNothing()
      .returning({ id: paymentEvents.id });
    if (!ev.signatureValid) {
      await this.security.record('payment_webhook_invalid_signature', { ip, meta: { provider: this.provider.name, eventType: ev.eventType } });
      throw Errors.forbidden('Недействительная подпись уведомления', 'invalid_signature');
    }
    if (!inserted.length) return { duplicate: true };
    if (!p) {
      this.logger.warn({ ev: ev.eventId }, 'Webhook for unknown payment');
      return { unknown: true };
    }
    // Источник истины — статус, запрошенный у провайдера, а не содержимое уведомления.
    await this.sync(p.id);
    await this.db.update(paymentEvents).set({ processedAt: new Date() }).where(eq(paymentEvents.id, inserted[0].id));
    return { ok: true };
  }

  async sync(paymentId: string): Promise<PaymentRow> {
    const [p] = await this.db.select().from(payments).where(eq(payments.id, paymentId));
    if (!p) throw Errors.notFound('Платёж');
    if (!p.providerPaymentId) return p;
    const remote = await this.provider.fetch(p.providerPaymentId);
    if (remote.amount !== p.amount) {
      await this.security.record('payment_amount_mismatch', { userId: p.userId, meta: { paymentId, expected: p.amount, got: remote.amount } });
      throw Errors.conflict('amount_mismatch', 'Сумма платежа не совпадает');
    }
    if (remote.status === 'succeeded' || remote.status === 'canceled' || remote.status === 'waiting_for_capture') {
      await this.applyStatus(paymentId, remote.status);
    }
    const [after] = await this.db.select().from(payments).where(eq(payments.id, paymentId));
    return after;
  }

  private async applyStatus(paymentId: string, status: PaymentStatus) {
    await this.db.transaction(async (tx) => {
      const [p] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for('update');
      if (!p || p.status === status) return;
      if (!ALLOWED[p.status].includes(status)) {
        this.logger.warn({ paymentId, from: p.status, to: status }, 'Ignored payment transition');
        return;
      }
      const [updated] = await tx
        .update(payments)
        .set({ status, paidAt: status === 'succeeded' ? new Date() : p.paidAt, updatedAt: new Date() })
        .where(eq(payments.id, paymentId))
        .returning();
      const hooks = this.hooks.get(p.purpose);
      if (status === 'succeeded') {
        track('payment_succeeded');
        await hooks?.succeeded(tx, updated);
      } else if (status === 'canceled') await hooks?.canceled(tx, updated);
    });
  }

  /** Отмена неоплаченного платежа на нашей стороне (например, при отмене заказа до оплаты). */
  async cancelPending(tx: DbOrTx, paymentId: string) {
    await tx
      .update(payments)
      .set({ status: 'canceled', updatedAt: new Date() })
      .where(and(eq(payments.id, paymentId), inArray(payments.status, ['pending'])));
  }

  /**
   * Возврат. Сумма не может превышать остаток; повтор с тем же ключом не создаёт второй возврат.
   */
  async refund(paymentId: string, amount: number | undefined, reason: string, initiatedBy: string | null, idempotencyKey?: string) {
    const key = idempotencyKey ?? `refund:${paymentId}:${amount ?? 'full'}:${reason}`.slice(0, 80);
    const [prev] = await this.db.select().from(refunds).where(eq(refunds.idempotencyKey, key));
    if (prev) return prev;
    const prepared = await this.db.transaction(async (tx) => {
      const [p] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for('update');
      if (!p) throw Errors.notFound('Платёж');
      if (p.status !== 'succeeded' && p.status !== 'partially_refunded') throw Errors.conflict('not_refundable', 'Платёж нельзя вернуть в текущем статусе');
      const pendingSum = await tx
        .select({ s: sql<string>`coalesce(sum(${refunds.amount}), 0)` })
        .from(refunds)
        .where(and(eq(refunds.paymentId, paymentId), eq(refunds.status, 'pending')));
      const available = p.amount - p.refundedAmount - Number(pendingSum[0].s);
      const value = amount ?? available;
      if (value <= 0 || value > available) throw Errors.badRequest('invalid_refund_amount', `Доступно к возврату: ${available / 100} ₽`);
      const [r] = await tx.insert(refunds).values({ paymentId, amount: value, reason, initiatedBy, idempotencyKey: key, status: 'pending' }).returning();
      return { refund: r, payment: p };
    });
    let result;
    try {
      result = await this.provider.refund({
        providerPaymentId: prepared.payment.providerPaymentId!,
        amount: prepared.refund.amount,
        currency: prepared.payment.currency,
        idempotencyKey: `refund:${prepared.refund.id}`,
        reason,
      });
    } catch (e) {
      this.logger.error({ err: e, paymentId }, 'Provider refund failed');
      // Ключ идемпотентности провайдера привязан к id возврата: повторная попытка создаст новый возврат с новым ключом,
      // поэтому неудачный помечается failed и освобождает сумму.
      await this.db
        .update(refunds)
        .set({ status: 'failed', idempotencyKey: `failed:${prepared.refund.id}`, updatedAt: new Date() })
        .where(eq(refunds.id, prepared.refund.id));
      throw new AppError(502, 'payment_provider_error', 'Платёжный сервис не ответил. Повторите возврат позже.');
    }
    if (result.status === 'canceled') {
      await this.db.update(refunds).set({ status: 'canceled', updatedAt: new Date() }).where(eq(refunds.id, prepared.refund.id));
      throw Errors.conflict('refund_rejected', 'Платёжный сервис отклонил возврат');
    }
    if (result.status === 'succeeded') await this.completeRefund(prepared.refund.id, result.providerRefundId);
    else await this.db.update(refunds).set({ providerRefundId: result.providerRefundId }).where(eq(refunds.id, prepared.refund.id));
    const [r] = await this.db.select().from(refunds).where(eq(refunds.id, prepared.refund.id));
    return r;
  }

  private async completeRefund(refundId: string, providerRefundId: string) {
    await this.db.transaction(async (tx) => {
      const [r] = await tx.select().from(refunds).where(eq(refunds.id, refundId)).for('update');
      if (!r || r.status === 'succeeded') return;
      const [p] = await tx.select().from(payments).where(eq(payments.id, r.paymentId)).for('update');
      const refunded = p.refundedAmount + r.amount;
      const [updated] = await tx
        .update(payments)
        .set({ refundedAmount: refunded, status: refunded >= p.amount ? 'refunded' : 'partially_refunded', updatedAt: new Date() })
        .where(eq(payments.id, p.id))
        .returning();
      await tx.update(refunds).set({ status: 'succeeded', providerRefundId, updatedAt: new Date() }).where(eq(refunds.id, refundId));
      track('payment_refunded');
      await this.hooks.get(p.purpose)?.refunded(tx, updated, r.amount, refundId);
    });
  }

  /** Сверка «зависших» платежей (webhook мог не дойти). */
  async reconcilePending() {
    const stale = await this.db
      .select({ id: payments.id })
      .from(payments)
      .where(and(eq(payments.status, 'pending'), lt(payments.createdAt, new Date(Date.now() - 5 * 60 * 1000))))
      .limit(200);
    for (const s of stale) await this.sync(s.id).catch((e) => this.logger.warn({ err: e, id: s.id }, 'reconcile failed'));
    return stale.length;
  }

  /** Действие на тестовой странице оплаты (только mock-провайдер). */
  async mockComplete(providerPaymentId: string, outcome: 'succeeded' | 'canceled') {
    if (!(this.provider instanceof MockPaymentProvider)) throw Errors.notFound('Страница');
    const hook = await this.provider.complete(providerPaymentId, outcome);
    if (!hook) throw Errors.conflict('mock_payment_closed', 'Платёж уже обработан');
    await this.jobs.enqueue('payments.mock-webhook', hook);
    return { ok: true };
  }

  async mockInfo(providerPaymentId: string) {
    if (!(this.provider instanceof MockPaymentProvider)) throw Errors.notFound('Страница');
    const remote = await this.provider.fetch(providerPaymentId).catch(() => null);
    if (!remote) throw Errors.notFound('Платёж');
    const [p] = await this.db.select().from(payments).where(eq(payments.providerPaymentId, providerPaymentId));
    return { providerPaymentId, status: remote.status, amount: remote.amount, description: p?.description ?? '', paymentId: p?.id ?? null, purpose: p?.purpose, orderId: p?.orderId, purchaseId: p?.purchaseId };
  }

  async getForUser(userId: string, id: string) {
    const [p] = await this.db
      .select()
      .from(payments)
      .where(and(eq(payments.id, id), eq(payments.userId, userId)));
    if (!p) throw Errors.notFound('Платёж');
    return presentPayment(p);
  }

  async listForUser(userId: string, page: number, limit: number) {
    const { offset } = paginate(page, limit);
    const [rows, [{ total }]] = await Promise.all([
      this.db.select().from(payments).where(eq(payments.userId, userId)).orderBy(desc(payments.createdAt)).limit(limit).offset(offset),
      this.db.select({ total: count() }).from(payments).where(eq(payments.userId, userId)),
    ]);
    return { items: rows.map(presentPayment), total, page, limit };
  }
}
