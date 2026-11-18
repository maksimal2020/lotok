import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import Redis from 'ioredis';
import type { PaymentStatus } from '@lotok/shared';
import type { AppConfig } from '../../../config/config';
import type { CreatePaymentRequest, ParsedWebhook, PaymentProvider, ProviderPayment, ProviderRefund } from './payment-provider';

interface MockState {
  status: PaymentStatus;
  amount: number;
  refunded: number;
  paymentId: string;
}

/**
 * ТЕСТОВЫЙ платёжный провайдер (sandbox). Реальные деньги не списываются.
 * Имитирует внешний сервис: собственное состояние в Redis, страница подтверждения,
 * асинхронные webhook-уведомления, подписанные HMAC-SHA256 (заголовок X-Mock-Signature).
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock';
  readonly testMode = true;

  constructor(
    private readonly redis: Redis,
    private readonly config: AppConfig,
  ) {}

  private key(id: string) {
    return `mockpay:${id}`;
  }

  async create(req: CreatePaymentRequest): Promise<ProviderPayment> {
    // Идемпотентность на стороне «провайдера»: повтор с тем же ключом возвращает тот же платёж.
    const idemKey = `mockpay-idem:${req.idempotencyKey}`;
    const existing = await this.redis.get(idemKey);
    if (existing) return this.fetch(existing);
    const id = `mock_${randomUUID()}`;
    const state: MockState = { status: 'pending', amount: req.amount, refunded: 0, paymentId: req.paymentId };
    await this.redis.set(this.key(id), JSON.stringify(state), 'EX', 7 * 86400);
    await this.redis.set(idemKey, id, 'EX', 86400);
    return { providerPaymentId: id, status: 'pending', amount: req.amount, confirmationUrl: `${this.config.WEB_URL}/payments/test/${id}` };
  }

  async fetch(id: string): Promise<ProviderPayment> {
    const raw = await this.redis.get(this.key(id));
    if (!raw) throw new Error(`Mock payment ${id} not found`);
    const s = JSON.parse(raw) as MockState;
    return { providerPaymentId: id, status: s.status, amount: s.amount, confirmationUrl: `${this.config.WEB_URL}/payments/test/${id}` };
  }

  /** Действие пользователя на тестовой странице оплаты. Возвращает webhook для отправки. */
  async complete(id: string, outcome: 'succeeded' | 'canceled'): Promise<{ body: string; signature: string } | null> {
    const raw = await this.redis.get(this.key(id));
    if (!raw) return null;
    const s = JSON.parse(raw) as MockState;
    if (s.status !== 'pending') return null;
    s.status = outcome;
    await this.redis.set(this.key(id), JSON.stringify(s), 'KEEPTTL');
    return this.buildWebhook(`payment.${outcome}`, id, s);
  }

  buildWebhook(event: string, id: string, s: MockState) {
    const body = JSON.stringify({ id: randomUUID(), event, object: { id, status: s.status, amount: s.amount, metadata: { paymentId: s.paymentId } } });
    return { body, signature: this.sign(body) };
  }

  sign(body: string) {
    return createHmac('sha256', this.config.MOCK_PAYMENT_WEBHOOK_SECRET).update(body).digest('hex');
  }

  async refund(req: { providerPaymentId: string; amount: number; idempotencyKey: string }): Promise<ProviderRefund> {
    const idem = `mockrefund-idem:${req.idempotencyKey}`;
    const prev = await this.redis.get(idem);
    if (prev) return { providerRefundId: prev, status: 'succeeded' };
    const raw = await this.redis.get(this.key(req.providerPaymentId));
    if (!raw) throw new Error('Mock payment not found');
    const s = JSON.parse(raw) as MockState;
    if (s.status !== 'succeeded' && s.status !== 'partially_refunded') return { providerRefundId: '', status: 'canceled' };
    if (s.refunded + req.amount > s.amount) return { providerRefundId: '', status: 'canceled' };
    s.refunded += req.amount;
    s.status = s.refunded === s.amount ? 'refunded' : 'partially_refunded';
    await this.redis.set(this.key(req.providerPaymentId), JSON.stringify(s), 'KEEPTTL');
    const refundId = `mockrf_${randomUUID()}`;
    await this.redis.set(idem, refundId, 'EX', 86400);
    return { providerRefundId: refundId, status: 'succeeded' };
  }

  async parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): Promise<ParsedWebhook> {
    const sig = String(headers['x-mock-signature'] ?? '');
    const expected = this.sign(rawBody.toString('utf8'));
    const valid = sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return { eventId: `invalid-${randomUUID()}`, eventType: 'invalid', providerPaymentId: null, signatureValid: false, payload: {} };
    }
    const obj = (payload.object ?? {}) as { id?: string };
    return {
      eventId: String(payload.id ?? randomUUID()),
      eventType: String(payload.event ?? 'unknown'),
      providerPaymentId: obj.id ?? null,
      signatureValid: valid,
      payload,
    };
  }
}
