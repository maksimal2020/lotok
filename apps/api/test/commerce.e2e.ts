import { createHmac } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { Client, createHarness, publishListing, sleep, staffClient, type Harness } from './harness';

const ADDRESS = { recipientName: 'Иван Иванов', recipientPhone: '+79991234567', city: 'Санкт-Петербург', address: 'Невский пр., 1, кв. 1' };

async function payViaMock(h: Harness, c: Client, order: { payment: { confirmationUrl: string } }, outcome: 'succeeded' | 'canceled' = 'succeeded') {
  const providerId = order.payment.confirmationUrl.split('/').pop()!;
  const info = await new Client(h).get(`/payments/test/${providerId}`);
  expect(info.status).toBe(200);
  const r = await new Client(h).post(`/payments/test/${providerId}/complete`, { outcome });
  expect(r.status).toBe(200);
  await h.jobs.drain();
  await sleep(50);
  return providerId;
}

describe('Orders, payments, ledger', () => {
  let h: Harness;
  let seller: Client;
  let buyer: Client;
  beforeAll(async () => {
    h = await createHarness();
    seller = new Client(h);
    buyer = new Client(h);
    await seller.register({ name: 'Продавец' });
    await buyer.register({ name: 'Покупатель' });
  });
  afterAll(() => h.close());

  it('full delivery flow: order → test payment → webhook → confirm → ship → deliver → complete → review', async () => {
    const l = await publishListing(seller, { price: 500000 });
    const created = await buyer.req('post', '/orders').set('Idempotency-Key', `idem-${l.id}`).send({ listingId: l.id, deliveryMethod: 'delivery', deliveryAddress: ADDRESS, payOnline: true });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('pending_payment');
    expect(created.body.payment.testMode).toBe(true);
    expect(created.body.deliveryPrice).toBe(45000);
    expect(created.body.total).toBe(545000);
    // Повтор с тем же ключом идемпотентности возвращает тот же заказ.
    const repeat = await buyer.req('post', '/orders').set('Idempotency-Key', `idem-${l.id}`).send({ listingId: l.id, deliveryMethod: 'delivery', deliveryAddress: ADDRESS, payOnline: true });
    expect(repeat.body.id).toBe(created.body.id);

    await payViaMock(h, buyer, created.body);
    let order = (await buyer.get(`/orders/${created.body.id}`)).body;
    expect(order.status).toBe('created');
    expect(order.paymentStatus).toBe('paid');

    const sellerView = await seller.get(`/orders/${order.id}`);
    expect(sellerView.body.availableActions).toEqual(expect.arrayContaining(['confirm', 'cancel']));
    expect(sellerView.body.commission).toBe(25000);
    expect((await buyer.post(`/orders/${order.id}/confirm`)).status).toBe(409);
    expect((await seller.post(`/orders/${order.id}/confirm`)).body.status).toBe('confirmed');
    expect((await buyer.post(`/orders/${order.id}/complete`)).status).toBe(409);
    const shipped = await seller.post(`/orders/${order.id}/ship`);
    expect(shipped.body.status).toBe('shipped');
    expect(shipped.body.trackingNumber).toMatch(/^TEST/);
    expect((await buyer.post(`/orders/${order.id}/cancel`)).status).toBe(409);
    expect((await seller.post(`/orders/${order.id}/deliver`)).body.status).toBe('delivered');
    order = (await buyer.post(`/orders/${order.id}/complete`)).body;
    expect(order.status).toBe('completed');
    expect(order.canReview).toBe(true);
    await sleep(50);
    // Товар (количество 1) после завершения сделки помечается проданным.
    expect((await seller.get(`/listings/${l.id}`)).body.status).toBe('sold');

    const review = await buyer.post('/reviews', { orderId: order.id, rating: 5, text: 'Всё отлично, быстро отправил' });
    expect(review.status).toBe(201);
    expect((await buyer.post('/reviews', { orderId: order.id, rating: 1 })).status).toBe(409);
    const profile = await new Client(h).get(`/users/${seller.userId}`);
    expect(profile.body.ratingAvg).toBe(5);
    expect(profile.body.ratingCount).toBe(1);
    const notes = await buyer.get('/notifications');
    expect(notes.body.items.some((n: { type: string }) => n.type === 'order.updated')).toBe(true);
  });

  it('webhooks: signature verified, duplicates ignored', async () => {
    const l = await publishListing(seller, { price: 100000 });
    const o = (await buyer.post('/orders', { listingId: l.id, deliveryMethod: 'pickup', payOnline: true })).body;
    const providerId = o.payment.confirmationUrl.split('/').pop();
    const body = JSON.stringify({ id: 'evt-forged', event: 'payment.succeeded', object: { id: providerId, status: 'succeeded' } });
    const forged = await h.http.post('/api/v1/payments/webhooks/mock').set('Content-Type', 'application/json').set('X-Mock-Signature', 'deadbeef').send(body);
    expect(forged.status).toBe(403);
    expect((await buyer.get(`/orders/${o.id}`)).body.status).toBe('pending_payment');
    // Даже корректно подписанное уведомление не меняет статус, если провайдер не подтверждает оплату.
    const sig = createHmac('sha256', h.config.MOCK_PAYMENT_WEBHOOK_SECRET).update(body).digest('hex');
    const signed = await h.http.post('/api/v1/payments/webhooks/mock').set('Content-Type', 'application/json').set('X-Mock-Signature', sig).send(body);
    expect(signed.status).toBe(200);
    expect((await buyer.get(`/orders/${o.id}`)).body.status).toBe('pending_payment');
    const dup = await h.http.post('/api/v1/payments/webhooks/mock').set('Content-Type', 'application/json').set('X-Mock-Signature', sig).send(body);
    expect(dup.body.duplicate).toBe(true);
    await payViaMock(h, buyer, o);
    expect((await buyer.get(`/orders/${o.id}`)).body.status).toBe('created');
  });

  it('cancel of a paid order refunds automatically; ledger stays balanced', async () => {
    const l = await publishListing(seller, { price: 200000 });
    const o = (await buyer.post('/orders', { listingId: l.id, deliveryMethod: 'pickup', payOnline: true })).body;
    await payViaMock(h, buyer, o);
    const canceled = await seller.post(`/orders/${o.id}/cancel`, { reason: 'Товар повреждён' });
    expect(canceled.body.status).toBe('canceled');
    await sleep(50);
    const after = (await buyer.get(`/orders/${o.id}`)).body;
    expect(after.paymentStatus).toBe('refunded');
    const pay = await buyer.get(`/payments/${after.payment.id}`);
    expect(pay.body.status).toBe('refunded');
    expect(pay.body.refundedAmount).toBe(200000);
    // Резерв снят — объявление снова доступно для покупки.
    expect((await new Client(h).get(`/listings/${l.id}`)).body.quantity).toBe(1);
    const finance = await staffClient(h, 'finance@lotok.local');
    const tb = await finance.get('/admin/ledger/trial-balance');
    expect(tb.body.balanced).toBe(true);
  });

  it('pickup without online payment and declined payment', async () => {
    const l = await publishListing(seller, { price: 150000 });
    const offline = await buyer.post('/orders', { listingId: l.id, deliveryMethod: 'pickup', payOnline: false });
    expect(offline.body.status).toBe('created');
    expect(offline.body.paymentStatus).toBe('not_required');
    expect((await buyer.post('/orders', { listingId: l.id, deliveryMethod: 'delivery', deliveryAddress: ADDRESS, payOnline: false })).status).toBe(400);
    await buyer.post(`/orders/${offline.body.id}/cancel`);
    const paid = (await buyer.post('/orders', { listingId: l.id, deliveryMethod: 'pickup', payOnline: true })).body;
    await payViaMock(h, buyer, paid, 'canceled');
    expect((await buyer.get(`/orders/${paid.id}`)).body.status).toBe('canceled');
  });

  it('prevents double sale of the last item under concurrency', async () => {
    const l = await publishListing(seller, { price: 300000 });
    const b2 = new Client(h);
    await b2.register();
    const results = await Promise.all([
      buyer.post('/orders', { listingId: l.id, deliveryMethod: 'pickup', payOnline: false }),
      b2.post('/orders', { listingId: l.id, deliveryMethod: 'pickup', payOnline: false }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)!.body.code).toBe('out_of_stock');
  });

  it('forbids buying own listing and accessing others’ orders', async () => {
    const l = await publishListing(seller, { price: 100000 });
    expect((await seller.post('/orders', { listingId: l.id, deliveryMethod: 'pickup', payOnline: false })).status).toBe(400);
    const o = (await buyer.post('/orders', { listingId: l.id, deliveryMethod: 'pickup', payOnline: false })).body;
    const stranger = new Client(h);
    await stranger.register();
    expect((await stranger.get(`/orders/${o.id}`)).status).toBe(404);
    expect((await stranger.post(`/orders/${o.id}/cancel`)).status).toBe(404);
    expect((await stranger.get(`/payments/${o.id}`)).status).toBe(404);
  });

  it('refund requests after delivery are approved by seller', async () => {
    const l = await publishListing(seller, { price: 400000 });
    const o = (await buyer.post('/orders', { listingId: l.id, deliveryMethod: 'delivery', deliveryAddress: ADDRESS, payOnline: true })).body;
    await payViaMock(h, buyer, o);
    await seller.post(`/orders/${o.id}/confirm`);
    await seller.post(`/orders/${o.id}/ship`);
    await seller.post(`/orders/${o.id}/deliver`);
    expect((await buyer.post(`/orders/${o.id}/request_refund`, { reason: 'Не соответствует описанию' })).body.status).toBe('refund_requested');
    expect((await seller.post(`/orders/${o.id}/approve_refund`)).body.status).toBe('refunded');
    await sleep(50);
    expect((await buyer.get(`/orders/${o.id}`)).body.paymentStatus).toBe('refunded');
  });
});

describe('Monetization: paid services, promotion, bonuses, quotas', () => {
  let h: Harness;
  let seller: Client;
  beforeAll(async () => {
    h = await createHarness();
    seller = new Client(h);
    await seller.register();
  });
  afterAll(() => h.close());

  it('premium promotion is purchased via test payment and shown in separate premium block', async () => {
    const l = await publishListing(seller, { title: 'Премиальный смартфон Vertu' });
    const catalog = await new Client(h).get('/billing/services').query({ listingId: l.id });
    expect(catalog.body.map((s: { code: string }) => s.code)).toContain('premium_7');
    const p = await seller.req('post', '/billing/purchases').set('Idempotency-Key', `prem-${l.id}`).send({ serviceCode: 'premium_7', listingId: l.id });
    expect(p.status).toBe(201);
    expect(p.body.status).toBe('pending_payment');
    await payViaMock(h, seller, { payment: { confirmationUrl: p.body.payment.confirmationUrl } });
    const after = await seller.get(`/billing/purchases/${p.body.id}`);
    expect(after.body.status).toBe('active');
    const search = await new Client(h).get('/search').query({ q: 'Vertu' });
    expect(search.body.premium.map((x: { id: string }) => x.id)).toContain(l.id);
    expect(search.body.premium[0].isPremium).toBe(true);
    // Органическая выдача не меняет порядок из-за оплаты.
    expect(search.body.items.find((x: { id: string }) => x.id === l.id)).toBeDefined();
  });

  it('cannot promote someone else’s or inactive listing', async () => {
    const other = new Client(h);
    await other.register();
    const l = await publishListing(seller);
    expect((await other.post('/billing/purchases', { serviceCode: 'bump_1', listingId: l.id })).status).toBe(404);
    await seller.post(`/listings/${l.id}/unpublish`);
    expect((await seller.post('/billing/purchases', { serviceCode: 'bump_1', listingId: l.id })).status).toBe(409);
  });

  it('pays with bonus balance (separate from money) and keeps ledger balanced', async () => {
    const finance = await staffClient(h, 'finance@lotok.local');
    const price = (await new Client(h).get('/billing/services')).body.find((s: { code: string }) => s.code === 'bump_1').price as number;
    const bonus = await finance.post(`/admin/users/${seller.userId}/bonus`, { amount: price + 100, reason: 'Компенсация', key: `bonus-${seller.userId}` });
    expect(bonus.body.posted).toBe(true);
    expect((await seller.get('/users/me')).body.bonusBalance).toBe(price + 100);
    const l = await publishListing(seller);
    const p = await seller.post('/billing/purchases', { serviceCode: 'bump_1', listingId: l.id, useBonus: true });
    expect(p.body.status).toBe('consumed');
    expect(p.body.paidWithBonus).toBe(price);
    expect(p.body.payment).toBeNull();
    expect((await seller.get('/users/me')).body.bonusBalance).toBe(100);
    const tb = await finance.get('/admin/ledger/trial-balance');
    expect(tb.body.balanced).toBe(true);
    // Бонусы не учитываются как выручка.
    const rev = await h.db.execute<{ s: string }>(sql`SELECT coalesce(sum(e.amount),0) AS s FROM ledger_entries e JOIN ledger_transactions t ON t.id = e.transaction_id JOIN ledger_accounts a ON a.id = e.account_id WHERE t.kind = 'bonus_spend' AND a.type = 'platform_revenue'`);
    expect(Number(rev.rows[0].s)).toBe(0);
  });

  it('paid listing slot unlocks publication over free limit; refund on rejection', async () => {
    const realtor = new Client(h);
    await realtor.register();
    const catId = (await h.db.execute<{ id: number }>(sql`SELECT id FROM categories WHERE slug = 'land'`)).rows[0].id;
    const land = (n: number, title = `Участок ИЖС номер ${n}`) =>
      publishListing(realtor, { categoryId: catId, title, price: 50000000, deliveryAvailable: false, attributes: { area_land: 6 + n, land_category: 'izhs' } }).catch((e: Error) => e);
    await land(1);
    await land(2);
    expect(String(await land(3))).toMatch(/listing_limit_exceeded/);
    const slot = await realtor.post('/billing/purchases', { serviceCode: 'listing_slot' });
    await payViaMock(h, realtor, { payment: { confirmationUrl: slot.body.payment.confirmationUrl } });
    expect((await realtor.get('/billing/quotas')).body[0].remaining).toBe(1);
    const rejected = (await land(4, 'Купить диплом и участок')) as { status: string };
    expect(rejected.status).toBe('rejected');
    // Отклонённая модерацией публикация возвращает списанный слот.
    expect((await realtor.get('/billing/quotas')).body[0].remaining).toBe(1);
    const ok = (await land(5)) as { status: string };
    expect(ok.status).toBe('active');
    expect((await realtor.get('/billing/quotas')).body).toHaveLength(0);
  });

  it('pro subscription gives extended stats', async () => {
    const l = await publishListing(seller);
    expect((await seller.get(`/listings/${l.id}/stats`).query({ extended: '1' })).body.extended).toBe(false);
    const p = await seller.post('/billing/purchases', { serviceCode: 'analytics_month' });
    await payViaMock(h, seller, { payment: { confirmationUrl: p.body.payment.confirmationUrl } });
    expect((await seller.get(`/listings/${l.id}/stats`).query({ extended: '1' })).body.extended).toBe(true);
  });
});
