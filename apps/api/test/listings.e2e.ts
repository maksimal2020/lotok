import { categoryId, cityId, Client, createHarness, jpeg, makeOld, publishListing, uploadPhoto, type Harness } from './harness';

describe('Listings lifecycle, media, moderation', () => {
  let h: Harness;
  let seller: Client;
  beforeAll(async () => {
    h = await createHarness();
    seller = new Client(h);
    await seller.register();
    await makeOld(h, seller.userId!);
  });
  afterAll(() => h.close());

  it('processes uploaded images into several sizes and strips originals', async () => {
    const id = await uploadPhoto(seller);
    const m = await seller.get(`/media/${id}`);
    expect(m.body.status).toBe('ready');
    expect(m.body.urls.thumb).toMatch(/thumb\.webp$/);
    expect(m.body.urls.medium).toMatch(/medium\.webp$/);
    expect(m.body.urls.large).toMatch(/large\.webp$/);
    expect(m.body.width).toBe(800);
    const file = await h.http.get(new URL(m.body.urls.thumb).pathname);
    expect(file.status).toBe(200);
    expect(file.headers['x-content-type-options']).toBe('nosniff');
  });

  it('rejects files by signature, not by extension', async () => {
    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200, 1)]);
    const r = await seller.req('post', '/media?purpose=listing').attach('file', exe, 'photo.jpg');
    expect(r.status).toBe(415);
    const html = Buffer.from('<html><script>alert(1)</script></html>'.padEnd(200, ' '));
    expect((await seller.req('post', '/media?purpose=listing').attach('file', html, 'x.png')).status).toBe(415);
    const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 32)]);
    expect((await seller.req('post', '/media?purpose=listing').attach('file', pdf, 'doc.pdf')).status).toBe(400);
  });

  it('rejects oversized uploads', async () => {
    const big = Buffer.concat([await jpeg(), Buffer.alloc(17 * 1024 * 1024)]);
    const r = await seller.req('post', '/media?purpose=listing').attach('file', big, 'big.jpg');
    expect([413, 400]).toContain(r.status);
  });

  it('marks corrupted images as failed instead of crashing', async () => {
    const broken = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(500, 7)]);
    const r = await seller.req('post', '/media?purpose=listing').attach('file', broken, 'broken.jpg');
    expect(r.status).toBe(201);
    await h.jobs.drain();
    expect((await seller.get(`/media/${r.body.id}`)).body.status).toBe('failed');
  });

  it('validates category attributes against admin-defined schema', async () => {
    const base = { categoryId: await categoryId(h, 'smartphones'), title: 'Телефон', price: 100000, cityId: await cityId(h, 'moskva') };
    const bad = await seller.post('/listings', { ...base, attributes: { phone_brand: 'nokia3310', unknown_attr: 1 } });
    expect(bad.status).toBe(400);
    expect(bad.body.details.map((d: { path: string }) => d.path)).toEqual(expect.arrayContaining(['attributes.phone_brand', 'attributes.unknown_attr']));
    const notLeaf = await seller.post('/listings', { ...base, categoryId: await categoryId(h, 'electronics') });
    expect(notLeaf.status).toBe(400);
    expect(notLeaf.body.code).toBe('category_not_leaf');
    const draft = await seller.post('/listings', base);
    expect(draft.status).toBe(201);
    // Обязательная характеристика проверяется при отправке на модерацию.
    const submit = await seller.post(`/listings/${draft.body.id}/submit`);
    expect(submit.status).toBe(400);
    expect(submit.body.details[0].path).toBe('attributes.phone_brand');
  });

  it('publishes via auto-moderation and appears publicly', async () => {
    const l = await publishListing(seller);
    expect(l.status).toBe('active');
    const pub = await new Client(h).get(`/listings/${l.id}`);
    expect(pub.status).toBe(200);
    expect(pub.body.attributes.find((a: { key: string }) => a.key === 'phone_brand').display).toBe('Samsung');
    expect(pub.body.photos).toHaveLength(1);
    expect(pub.body.isOwner).toBe(false);
  });

  it('auto-rejects listings with prohibited stop words and contacts in title', async () => {
    const banned = await publishListing(seller, { title: 'Купить диплом недорого', description: 'Любой вуз' });
    expect(banned.status).toBe('rejected');
    const contacts = await publishListing(seller, { title: 'Телефон звоните +7 999 123-45-67' });
    expect(contacts.status).toBe('rejected');
    const flagged = await publishListing(seller, { description: 'Только предоплата 100%, пишите в телеграм @seller_tg' });
    expect(flagged.status).toBe('moderation');
    // Отклонённое не видно публично.
    expect((await new Client(h).get(`/listings/${banned.id}`)).status).toBe(404);
  });

  it('enforces the lifecycle state machine', async () => {
    const l = await publishListing(seller);
    expect((await seller.post(`/listings/${l.id}/archive`)).status).toBe(409);
    const unpub = await seller.post(`/listings/${l.id}/unpublish`);
    expect(unpub.body.status).toBe('inactive');
    const rep = await seller.post(`/listings/${l.id}/republish`);
    expect(rep.body.status).toBe('active');
    const sold = await seller.post(`/listings/${l.id}/sold`);
    expect(sold.body.status).toBe('sold');
    expect((await seller.post(`/listings/${l.id}/unpublish`)).status).toBe(409);
    const arch = await seller.post(`/listings/${l.id}/archive`);
    expect(arch.body.status).toBe('archived');
    const hist = await seller.get(`/listings/${l.id}/history`);
    expect(hist.body.map((x: { toStatus: string }) => x.toStatus)).toEqual(['draft', 'moderation', 'active', 'inactive', 'moderation', 'active', 'sold', 'archived']);
    expect((await seller.del(`/listings/${l.id}`)).status).toBe(204);
    expect((await seller.get(`/listings/${l.id}`)).status).toBe(404);
  });

  it('prevents IDOR on listings and media', async () => {
    const l = await publishListing(seller);
    const other = new Client(h);
    await other.register();
    expect((await other.patch(`/listings/${l.id}`, { title: 'Взлом', version: l.version })).status).toBe(404);
    expect((await other.post(`/listings/${l.id}/unpublish`)).status).toBe(404);
    expect((await other.get(`/listings/${l.id}/stats`)).status).toBe(404);
    const photo = await uploadPhoto(seller);
    expect((await other.get(`/media/${photo}`)).status).toBe(404);
    expect((await other.del(`/media/${photo}`)).status).toBe(404);
    // Чужое фото нельзя прикрепить к своему объявлению.
    const steal = await other.post('/listings', { categoryId: await categoryId(h, 'smartphones'), title: 'Чужое фото', cityId: await cityId(h, 'moskva'), mediaIds: [photo] });
    expect(steal.status).toBe(400);
  });

  it('detects concurrent edits with optimistic locking', async () => {
    const l = await publishListing(seller);
    const [a, b] = await Promise.all([
      seller.patch(`/listings/${l.id}`, { price: 900000, version: l.version }),
      seller.patch(`/listings/${l.id}`, { price: 800000, version: l.version }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const conflict = a.status === 409 ? a : b;
    expect(conflict.body.code).toBe('version_conflict');
  });

  it('sends significantly edited active listing to re-moderation', async () => {
    const l = await publishListing(seller);
    const r = await seller.patch(`/listings/${l.id}`, { title: 'Совсем другой заголовок смартфона', version: l.version });
    expect(r.status).toBe(200);
    // Автомодерация повторно одобряет чистое объявление.
    expect(r.body.status).toBe('active');
    const priceOnly = await seller.patch(`/listings/${l.id}`, { price: 777700, version: r.body.version });
    expect(priceOnly.body.status).toBe('active');
  });

  it('counts unique views and reveals phone only when allowed', async () => {
    const l = await publishListing(seller);
    const viewer = new Client(h);
    await viewer.register();
    await viewer.post(`/listings/${l.id}/view`);
    await viewer.post(`/listings/${l.id}/view`);
    const stats = await seller.get(`/listings/${l.id}/stats`);
    expect(stats.body.totals.views).toBe(1);
    const phone = await viewer.get(`/listings/${l.id}/phone`);
    expect(phone.status).toBe(403);
    expect((await new Client(h).get(`/listings/${l.id}/phone`)).status).toBe(401);
  });

  it('requires verified phone to show phone in contacts', async () => {
    const r = await seller.post('/listings', {
      categoryId: await categoryId(h, 'smartphones'),
      title: 'С телефоном',
      cityId: await cityId(h, 'moskva'),
      contactMethods: ['chat', 'phone'],
    });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('phone_not_verified');
  });

  it('enforces free listing limits per category (paid slot required)', async () => {
    const realtor = new Client(h);
    await realtor.register();
    await makeOld(h, realtor.userId!);
    const flat = async (n: number) =>
      publishListing(realtor, {
        categoryId: await categoryId(h, 'flats-rent'),
        title: `Квартира ${n}`,
        price: 3000000,
        deliveryAvailable: false,
        attributes: { rooms: '1', area_total: 30 + n, rent_term: 'long' },
      }).catch((e: Error) => e);
    expect(((await flat(1)) as { status: string }).status).toBe('active');
    expect(((await flat(2)) as { status: string }).status).toBe('active');
    const third = await flat(3);
    expect(String(third)).toMatch(/402/);
    expect(String(third)).toMatch(/listing_limit_exceeded/);
  });
});
