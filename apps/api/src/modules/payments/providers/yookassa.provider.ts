import { randomUUID } from 'node:crypto';
import net from 'node:net';
import type { PaymentStatus } from '@lotok/shared';
import type { AppConfig } from '../../../config/config';
import type { CreatePaymentRequest, ParsedWebhook, PaymentProvider, ProviderPayment, ProviderRefund } from './payment-provider';

/** Диапазоны адресов, с которых ЮKassa отправляет уведомления (по документации ЮKassa; сверять перед запуском). */
const YOOKASSA_NETS = ['185.71.76.0/27', '185.71.77.0/27', '77.75.153.0/25', '77.75.156.11/32', '77.75.156.35/32', '77.75.154.128/25'];
const YOOKASSA_V6 = '2a02:5180:';

function ipInCidr(ip: string, cidr: string): boolean {
  const [range, bitsStr] = cidr.split('/');
  const bits = Number(bitsStr);
  const toInt = (a: string) => a.split('.').reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (toInt(ip) & mask) === (toInt(range) & mask);
}

const STATUS: Record<string, PaymentStatus> = {
  pending: 'pending',
  waiting_for_capture: 'waiting_for_capture',
  succeeded: 'succeeded',
  canceled: 'canceled',
};

const money = (minor: number) => (minor / 100).toFixed(2);
const toMinor = (v: string) => Math.round(Number(v) * 100);

/**
 * Адаптер ЮKassa (API v3). Используется в production при PAYMENT_PROVIDER=yookassa.
 * ВНИМАНИЕ: адаптер не проверялся на боевом/тестовом магазине ЮKassa в рамках разработки —
 * перед запуском обязательна проверка в тестовом магазине (см. docs/DEPLOYMENT.md).
 * ЮKassa не подписывает уведомления: подлинность подтверждается IP-адресом отправителя
 * и повторным запросом статуса платежа через API (источник истины — ответ API).
 */
export class YooKassaProvider implements PaymentProvider {
  readonly name = 'yookassa';
  readonly testMode: boolean;

  constructor(private readonly config: AppConfig) {
    this.testMode = String(config.YOOKASSA_SECRET_KEY ?? '').startsWith('test_');
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    const auth = Buffer.from(`${this.config.YOOKASSA_SHOP_ID}:${this.config.YOOKASSA_SECRET_KEY}`).toString('base64');
    const res = await fetch(`${this.config.YOOKASSA_API_URL}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
        ...(idempotencyKey ? { 'Idempotence-Key': idempotencyKey } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => ({}))) as T & { type?: string; description?: string };
    if (!res.ok) throw new Error(`YooKassa ${res.status}: ${data.description ?? 'error'}`);
    return data;
  }

  async create(req: CreatePaymentRequest): Promise<ProviderPayment> {
    const body: Record<string, unknown> = {
      amount: { value: money(req.amount), currency: req.currency },
      capture: true,
      confirmation: { type: 'redirect', return_url: req.returnUrl },
      description: req.description.slice(0, 128),
      metadata: { ...req.metadata, paymentId: req.paymentId },
    };
    if (req.receiptItems?.length && (req.customerEmail || req.customerPhone)) {
      body.receipt = {
        customer: req.customerEmail ? { email: req.customerEmail } : { phone: req.customerPhone },
        items: req.receiptItems.map((i) => ({
          description: i.description.slice(0, 128),
          quantity: String(i.quantity),
          amount: { value: money(i.amount), currency: req.currency },
          vat_code: i.vatCode,
          payment_mode: 'full_payment',
          payment_subject: i.paymentSubject,
        })),
      };
    }
    const r = await this.call<{ id: string; status: string; amount: { value: string }; confirmation?: { confirmation_url?: string } }>(
      'POST',
      '/payments',
      body,
      req.idempotencyKey,
    );
    return { providerPaymentId: r.id, status: STATUS[r.status] ?? 'pending', amount: toMinor(r.amount.value), confirmationUrl: r.confirmation?.confirmation_url ?? null };
  }

  async fetch(id: string): Promise<ProviderPayment> {
    const r = await this.call<{ id: string; status: string; amount: { value: string }; refunded_amount?: { value: string }; confirmation?: { confirmation_url?: string } }>(
      'GET',
      `/payments/${encodeURIComponent(id)}`,
    );
    let status = STATUS[r.status] ?? 'pending';
    if (status === 'succeeded' && r.refunded_amount) {
      const refunded = toMinor(r.refunded_amount.value);
      if (refunded > 0) status = refunded >= toMinor(r.amount.value) ? 'refunded' : 'partially_refunded';
    }
    return { providerPaymentId: r.id, status, amount: toMinor(r.amount.value), confirmationUrl: r.confirmation?.confirmation_url ?? null };
  }

  async refund(req: { providerPaymentId: string; amount: number; currency: string; idempotencyKey: string; reason: string }): Promise<ProviderRefund> {
    const r = await this.call<{ id: string; status: string }>(
      'POST',
      '/refunds',
      { payment_id: req.providerPaymentId, amount: { value: money(req.amount), currency: req.currency }, description: req.reason.slice(0, 250) },
      req.idempotencyKey,
    );
    return { providerRefundId: r.id, status: r.status === 'succeeded' ? 'succeeded' : r.status === 'canceled' ? 'canceled' : 'pending' };
  }

  async parseWebhook(rawBody: Buffer, _headers: Record<string, string | string[] | undefined>, ip: string | null): Promise<ParsedWebhook> {
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return { eventId: `invalid-${randomUUID()}`, eventType: 'invalid', providerPaymentId: null, signatureValid: false, payload: {} };
    }
    const cleanIp = (ip ?? '').replace(/^::ffff:/, '');
    let ipValid = !this.config.YOOKASSA_CHECK_WEBHOOK_IP;
    if (!ipValid && cleanIp) {
      ipValid = net.isIPv4(cleanIp) ? YOOKASSA_NETS.some((c) => ipInCidr(cleanIp, c)) : cleanIp.toLowerCase().startsWith(YOOKASSA_V6);
    }
    const obj = (payload.object ?? {}) as { id?: string; payment_id?: string; status?: string };
    const event = String(payload.event ?? 'unknown');
    const providerPaymentId = event.startsWith('refund.') ? (obj.payment_id ?? null) : (obj.id ?? null);
    return {
      // У ЮKassa нет id события: ключ дедупликации — тип события + объект + статус.
      eventId: `${event}:${obj.id ?? 'none'}:${obj.status ?? ''}`,
      eventType: event,
      providerPaymentId,
      signatureValid: ipValid,
      payload,
    };
  }
}
