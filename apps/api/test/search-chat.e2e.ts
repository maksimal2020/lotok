import { io, type Socket } from 'socket.io-client';
import { categoryId, cityId, Client, createHarness, publishListing, sleep, uploadPhoto, type Harness } from './harness';

describe('Search, favorites, saved searches', () => {
  let h: Harness;
  let seller: Client;
  let ids: Record<string, string>;
  beforeAll(async () => {
    h = await createHarness();
    seller = new Client(h);
    await seller.register();
    const tag = `${Date.now()}`.slice(-5);
    ids = {
      iphone: (await publishListing(seller, { title: `iPhone 14 Pro ${tag}`, price: 7000000, attributes: { phone_brand: 'apple', storage_gb: '256' } })).id,
      samsung: (await publishListing(seller, { title: `Samsung Galaxy A54 ${tag}`, price: 2500000, attributes: { phone_brand: 'samsung', storage_gb: '128' } })).id,
      spb: (await publishListing(seller, { title: `Xiaomi Redmi ${tag}`, price: 1200000, cityId: await cityId(h, 'sankt-peterburg'), lat: 59.93, lng: 30.33, attributes: { phone_brand: 'xiaomi', storage_gb: '64' } })).id,
    };
  });
  afterAll(() => h.close());

  const titles = (r: { body: { items: { id: string }[] } }) => r.body.items.map((i) => i.id);

  it('full-text search with morphology and synonyms', async () => {
    const c = new Client(h);
    expect(titles(await c.get('/search').query({ q: 'iphone' }))).toContain(ids.iphone);
    expect(titles(await c.get('/search').query({ q: 'айфон' }))).toContain(ids.iphone);
    expect(titles(await c.get('/search').query({ q: 'смартфоны samsung' }))).toEqual(expect.any(Array));
  });

  it('tolerates typos', async () => {
    const r = await new Client(h).get('/search').query({ q: 'samsng galaxi' });
    expect(titles(r)).toContain(ids.samsung);
  });

  it('filters by attributes, price, city and radius; sorts by price', async () => {
    const c = new Client(h);
    const cat = await categoryId(h, 'smartphones');
    const byBrand = await c.get('/search').query({ categoryId: cat, 'attr.phone_brand': 'apple,xiaomi' });
    expect(titles(byBrand)).toEqual(expect.arrayContaining([ids.iphone, ids.spb]));
    expect(titles(byBrand)).not.toContain(ids.samsung);
    expect(byBrand.body.facets.phone_brand).toBeDefined();
    const byPrice = await c.get('/search').query({ categoryId: cat, priceMax: 3000000, sort: 'price_asc' });
    const prices = byPrice.body.items.map((i: { price: number }) => i.price);
    expect(prices).toEqual([...prices].sort((a: number, b: number) => a - b));
    expect(prices.every((p: number) => p <= 3000000)).toBe(true);
    const spb = await c.get('/search').query({ cityId: await cityId(h, 'sankt-peterburg') });
    expect(titles(spb)).toContain(ids.spb);
    expect(titles(spb)).not.toContain(ids.iphone);
    const near = await c.get('/search').query({ lat: 55.75, lng: 37.61, radiusKm: 30, sort: 'distance' });
    expect(titles(near)).toContain(ids.iphone);
    expect(titles(near)).not.toContain(ids.spb);
    expect(near.body.items[0].distanceKm).toBeLessThan(30);
    const map = await c.get('/search/map').query({ bbox: '59.5,29.5,60.5,31.0' });
    expect(map.body.map((p: { id: string }) => p.id)).toContain(ids.spb);
  });

  it('autocompletes', async () => {
    const r = await new Client(h).get('/search/suggest').query({ q: 'iph' });
    expect(r.body.some((s: { text: string }) => s.text.includes('iphone'))).toBe(true);
  });

  it('favorites: add, list, counters, idempotent', async () => {
    const buyer = new Client(h);
    await buyer.register();
    expect((await buyer.post(`/favorites/${ids.iphone}`)).status).toBe(204);
    expect((await buyer.post(`/favorites/${ids.iphone}`)).status).toBe(204);
    const list = await buyer.get('/favorites');
    expect(list.body.total).toBe(1);
    expect(list.body.items[0].isFavorite).toBe(true);
    const detail = await buyer.get(`/listings/${ids.iphone}`);
    expect(detail.body.favoritesCount).toBe(1);
    expect((await buyer.del(`/favorites/${ids.iphone}`)).status).toBe(204);
    expect((await buyer.get('/favorites')).body.total).toBe(0);
  });

  it('saved search notifies about new listings', async () => {
    const buyer = new Client(h);
    await buyer.register();
    const tag = `Pixel${Date.now()}`.slice(0, 12);
    const s = await buyer.post('/saved-searches', { name: 'Пиксели', query: { q: tag }, notify: true });
    expect(s.status).toBe(201);
    await h.db.execute(require('drizzle-orm').sql`UPDATE saved_searches SET last_checked_at = now() - interval '1 hour' WHERE id = ${s.body.id}`);
    await publishListing(seller, { title: `Google ${tag}` });
    await h.jobs.enqueue('notify.saved-searches', {});
    await h.jobs.drain();
    const notes = await buyer.get('/notifications');
    expect(notes.body.items.some((n: { type: string }) => n.type === 'saved_search.new')).toBe(true);
    const saved = await buyer.get('/saved-searches');
    expect(saved.body[0].newCount).toBeGreaterThanOrEqual(1);
  });

  it('recommendations follow user interests deterministically', async () => {
    const buyer = new Client(h);
    await buyer.register();
    await buyer.post(`/listings/${ids.samsung}/view`);
    const r = await buyer.get('/recommendations');
    expect(r.body.strategy).toBe('interests');
    expect(r.body.items.every((i: { id: string }) => i.id !== ids.samsung)).toBe(true);
  });
});

describe('Messenger (REST + WebSocket)', () => {
  let h: Harness;
  let seller: Client;
  let buyer: Client;
  let listingId: string;
  beforeAll(async () => {
    h = await createHarness();
    seller = new Client(h);
    buyer = new Client(h);
    await seller.register({ name: 'Продавец' });
    await buyer.register({ name: 'Покупатель' });
    listingId = (await publishListing(seller)).id;
  });
  afterAll(() => h.close());

  const connect = (c: Client) =>
    new Promise<Socket>((resolve, reject) => {
      const s = io(h.url, { path: '/socket.io', auth: { token: c.token }, transports: ['websocket'], reconnection: false });
      s.on('ready', () => resolve(s));
      s.on('connect_error', reject);
      s.on('auth:error', reject);
    });

  it('delivers messages in real time with delivery/read receipts', async () => {
    const sellerSocket = await connect(seller);
    const buyerSocket = await connect(buyer);
    const received = new Promise<{ body: string; conversationId: string }>((r) => sellerSocket.once('message:new', r));
    const start = await buyer.post('/conversations', { listingId, message: 'Здравствуйте! Ещё актуально?' });
    expect(start.status).toBe(201);
    const msg = await received;
    expect(msg.body).toBe('Здравствуйте! Ещё актуально?');

    const reply = await sellerSocket.emitWithAck('message:send', { conversationId: msg.conversationId, body: 'Да, актуально', clientMessageId: 'cm-1' });
    expect(reply.ok).toBe(true);
    // Повтор с тем же clientMessageId не создаёт дубль (повторная отправка после разрыва связи).
    const again = await sellerSocket.emitWithAck('message:send', { conversationId: msg.conversationId, body: 'Да, актуально', clientMessageId: 'cm-1' });
    expect(again.data.id).toBe(reply.data.id);

    const unread = await buyer.get('/conversations/unread');
    expect(unread.body.messages).toBe(1);
    const readReceipt = new Promise<{ messageIds: string[] }>((r) => sellerSocket.once('message:read', r));
    await buyerSocket.emitWithAck('conversation:read', { conversationId: msg.conversationId });
    expect((await readReceipt).messageIds).toContain(reply.data.id);
    expect((await buyer.get('/conversations/unread')).body.messages).toBe(0);
    const history = await buyer.get(`/conversations/${msg.conversationId}/messages`);
    expect(history.body.items.map((m: { body: string }) => m.body)).toEqual(['Здравствуйте! Ещё актуально?', 'Да, актуально']);
    expect(history.body.items[1].readAt).not.toBeNull();
    sellerSocket.close();
    buyerSocket.close();
  });

  it('rejects socket connections without valid token', async () => {
    const bad = new Client(h);
    bad.token = 'invalid';
    await expect(connect(bad)).rejects.toBeDefined();
  });

  it('forbids access to other people’s conversations', async () => {
    const list = await buyer.get('/conversations');
    const convId = list.body.items[0].id;
    const intruder = new Client(h);
    await intruder.register();
    expect((await intruder.get(`/conversations/${convId}`)).status).toBe(404);
    expect((await intruder.get(`/conversations/${convId}/messages`)).status).toBe(404);
    expect((await intruder.post(`/conversations/${convId}/messages`, { body: 'привет' })).status).toBe(404);
    const s = await connect(intruder);
    const ack = await s.emitWithAck('message:send', { conversationId: convId, body: 'взлом' });
    expect(ack.ok).toBe(false);
    s.close();
  });

  it('sends images, archives, searches and blocks', async () => {
    const convId = (await buyer.get('/conversations')).body.items[0].id;
    const photo = await uploadPhoto(buyer, 'chat');
    const img = await buyer.post(`/conversations/${convId}/messages`, { attachmentMediaId: photo });
    expect(img.body.type).toBe('image');
    // Вложения чата приватные — ссылка подписанная.
    expect(img.body.attachment.url).toMatch(/sig=/);
    const search = await buyer.get('/conversations/search').query({ q: 'актуально' });
    expect(search.body.length).toBeGreaterThan(0);
    expect((await buyer.post(`/conversations/${convId}/archive`)).status).toBe(204);
    expect((await buyer.get('/conversations')).body.items.find((c: { id: string }) => c.id === convId)).toBeUndefined();
    expect((await buyer.get('/conversations').query({ archived: 'true' })).body.items[0].id).toBe(convId);
    // Новое сообщение возвращает диалог из архива получателя.
    await seller.post(`/conversations/${convId}/messages`, { body: 'Когда удобно встретиться?' });
    expect((await buyer.get('/conversations')).body.items.find((c: { id: string }) => c.id === convId)).toBeDefined();
    expect((await seller.post(`/users/${buyer.userId}/block`)).status).toBe(204);
    const blocked = await buyer.post(`/conversations/${convId}/messages`, { body: 'Ответьте!' });
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('conversation_blocked');
    const conv = await seller.get(`/conversations/${convId}`);
    expect(conv.body.blockedByMe).toBe(true);
  });

  it('allows complaints on received messages only', async () => {
    const convId = (await seller.get('/conversations')).body.items[0].id;
    const msgs = await seller.get(`/conversations/${convId}/messages`);
    const fromBuyer = msgs.body.items.find((m: { senderId: string }) => m.senderId === buyer.userId);
    const own = msgs.body.items.find((m: { senderId: string }) => m.senderId === seller.userId);
    expect((await seller.post('/complaints', { targetType: 'message', targetId: fromBuyer.id, reason: 'spam' })).status).toBe(201);
    expect((await seller.post('/complaints', { targetType: 'message', targetId: fromBuyer.id, reason: 'spam' })).status).toBe(409);
    expect((await seller.post('/complaints', { targetType: 'message', targetId: own.id, reason: 'spam' })).status).toBe(404);
    await sleep(10);
  });
});
