import type { PaymentStatus } from '@lotok/shared';

export interface CreatePaymentRequest {
  paymentId: string;
  amount: number;
  currency: string;
  description: string;
  returnUrl: string;
  idempotencyKey: string;
  metadata: Record<string, string>;
  customerEmail?: string | null;
  customerPhone?: string | null;
  /** Позиции чека (54-ФЗ). Передаются провайдеру, если он формирует чеки. */
  receiptItems?: { description: string; quantity: number; amount: number; vatCode: number; paymentSubject: 'commodity' | 'service' }[];
}

export interface ProviderPayment {
  providerPaymentId: string;
  status: PaymentStatus;
  amount: number;
  confirmationUrl: string | null;
}

export interface ProviderRefund {
  providerRefundId: string;
  status: 'pending' | 'succeeded' | 'canceled';
}

export interface ParsedWebhook {
  eventId: string;
  eventType: string;
  providerPaymentId: string | null;
  signatureValid: boolean;
  payload: Record<string, unknown>;
}

/**
 * Абстракция платёжного провайдера. Платформа не принимает и не хранит данные банковских карт:
 * пользователь вводит их на странице провайдера (confirmationUrl).
 */
export interface PaymentProvider {
  readonly name: string;
  readonly testMode: boolean;
  create(req: CreatePaymentRequest): Promise<ProviderPayment>;
  fetch(providerPaymentId: string): Promise<ProviderPayment>;
  refund(req: { providerPaymentId: string; amount: number; currency: string; idempotencyKey: string; reason: string }): Promise<ProviderRefund>;
  /** Проверка подлинности уведомления. Невалидные уведомления сохраняются для расследования, но не обрабатываются. */
  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>, ip: string | null): Promise<ParsedWebhook>;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
