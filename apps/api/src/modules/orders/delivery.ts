import { createHash } from 'node:crypto';

export interface DeliveryQuoteResult {
  provider: string;
  providerName: string;
  price: number;
  daysMin: number;
  daysMax: number;
  testMode: boolean;
}

export interface ShipmentResult {
  providerShipmentId: string;
  trackingNumber: string;
  status: string;
}

/**
 * Абстракция службы доставки (СДЭК, Boxberry, Почта России, Яндекс Доставка подключаются отдельными адаптерами
 * с официальными API и договорами). Сейчас реализован только тестовый провайдер.
 */
export interface DeliveryProvider {
  readonly code: string;
  readonly name: string;
  readonly testMode: boolean;
  quote(fromCity: string, toCity: string, weightGrams: number): Promise<DeliveryQuoteResult>;
  createShipment(input: { orderId: string; fromCity: string; toCity: string; address: Record<string, unknown> }): Promise<ShipmentResult>;
  track(trackingNumber: string): Promise<{ status: string; events: { at: string; status: string; description: string }[] }>;
}

/** Тестовая служба доставки: детерминированный тариф, фиктивный трек-номер. Реальные отправления не создаются. */
export class MockDeliveryProvider implements DeliveryProvider {
  readonly code = 'mock';
  readonly name = 'Тестовая доставка';
  readonly testMode = true;

  async quote(fromCity: string, toCity: string, weightGrams: number): Promise<DeliveryQuoteResult> {
    const same = fromCity.trim().toLowerCase() === toCity.trim().toLowerCase();
    const base = same ? 250_00 : 450_00;
    const weightFee = Math.max(0, Math.ceil((weightGrams - 1000) / 1000)) * 50_00;
    return { provider: this.code, providerName: this.name, price: base + weightFee, daysMin: same ? 1 : 3, daysMax: same ? 2 : 7, testMode: true };
  }

  async createShipment(input: { orderId: string }): Promise<ShipmentResult> {
    const tn = `TEST${createHash('sha1').update(input.orderId).digest('hex').slice(0, 10).toUpperCase()}`;
    return { providerShipmentId: `mock-${input.orderId}`, trackingNumber: tn, status: 'created' };
  }

  async track(_tn: string) {
    return { status: 'in_transit', events: [{ at: new Date().toISOString(), status: 'in_transit', description: 'Тестовое отправление в пути' }] };
  }
}

export const DELIVERY_PROVIDERS = Symbol('DELIVERY_PROVIDERS');
