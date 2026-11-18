import { Client, createHarness, publishListing, staffClient, type Harness } from './harness';

describe('Admin panel API: RBAC, moderation, complaints, audit', () => {
  let h: Harness;
  let admin: Client;
  let moderator: Client;
  let support: Client;
  let finance: Client;
  let user: Client;
  beforeAll(async () => {
    h = await createHarness();
    admin = await staffClient(h, 'admin@lotok.local');
    moderator = await staffClient(h, 'moderator@lotok.local');
    support = await staffClient(h, 'support@lotok.local');
    finance = await staffClient(h, 'finance@lotok.local');
    user = new Client(h);
    await user.register();
  });
  afterAll(() => h.close());

  it('regular users have no access to admin API', async () => {
    expect((await user.get('/admin/dashboard')).status).toBe(403);
    expect((await user.get('/admin/users')).status).toBe(403);
    expect((await new Client(h).get('/admin/dashboard')).status).toBe(401);
  });

  it('permissions are enforced per role on the backend', async () => {
    expect((await moderator.get('/admin/dashboard')).status).toBe(200);
    expect((await moderator.get('/admin/moderation/queue')).status).toBe(200);
    expect((await moderator.get('/admin/payments')).status).toBe(403);
    expect((await moderator.post('/admin/categories', { slug: 'x-cat', name: 'Тест', vertical: 'goods' })).status).toBe(403);
    expect((await support.get('/admin/orders')).status).toBe(200);
    expect((await support.get('/admin/settings')).status).toBe(403);
    expect((await finance.get('/admin/payments')).status).toBe(200);
    expect((await finance.get('/admin/moderation/queue')).status).toBe(403);
    expect((await finance.put(`/admin/users/${user.userId}/roles`, { roles: ['admin'] })).status).toBe(403);
  });

  it('only super admin assigns roles; changes take effect immediately', async () => {
    const target = new Client(h);
    await target.register();
    expect((await target.get('/admin/dashboard')).status).toBe(403);
    expect((await admin.put(`/admin/users/${target.userId}/roles`, { roles: ['support'] })).status).toBe(200);
    expect((await target.get('/admin/dashboard')).status).toBe(200);
    const me = await target.get('/users/me');
    expect(me.body.permissions).toContain('orders.read');
    await admin.put(`/admin/users/${target.userId}/roles`, { roles: [] });
    expect((await target.get('/admin/dashboard')).status).toBe(403);
  });

  it('moderation queue: approve and reject with reason, audit logged', async () => {
    const seller = new Client(h);
    await seller.register();
    const l = await publishListing(seller, { description: 'Пишите в whatsapp, отвечу быстро' });
    expect(l.status).toBe('moderation');
    const queue = await moderator.get('/admin/moderation/queue');
    const item = queue.body.items.find((x: { id: string }) => x.id === l.id);
    expect(item.flags).toContain('contacts_in_description');
    expect((await moderator.post(`/admin/listings/${l.id}/moderate`, { decision: 'reject' })).status).toBe(400);
    expect((await moderator.post(`/admin/listings/${l.id}/moderate`, { decision: 'reject', reason: 'Контакты в описании' })).status).toBe(204);
    const mine = await seller.get(`/listings/${l.id}`);
    expect(mine.body.status).toBe('rejected');
    expect(mine.body.rejectionReason).toBe('Контакты в описании');
    await seller.patch(`/listings/${l.id}`, { description: 'Пишите в чат', version: mine.body.version });
    const resubmitted = await seller.post(`/listings/${l.id}/submit`);
    expect(['active', 'moderation']).toContain(resubmitted.body.status);
    if (resubmitted.body.status === 'moderation') {
      expect((await moderator.post(`/admin/listings/${l.id}/moderate`, { decision: 'approve' })).status).toBe(204);
    }
    const audit = await admin.get('/admin/audit').query({ entityType: 'listing', entityId: l.id });
    expect(audit.body.items.map((a: { action: string }) => a.action)).toContain('listing.reject');
  });

  it('complaints: auto re-moderation threshold, resolution blocks listing and notifies reporter', async () => {
    const seller = new Client(h);
    await seller.register();
    const l = await publishListing(seller);
    const reporters = [new Client(h), new Client(h), new Client(h)];
    for (const r of reporters) {
      await r.register();
      expect((await r.post('/complaints', { targetType: 'listing', targetId: l.id, reason: 'fraud', comment: 'Просит предоплату' })).status).toBe(201);
    }
    expect((await seller.get(`/listings/${l.id}`)).body.status).toBe('moderation');
    const list = await moderator.get('/admin/complaints').query({ status: 'new' });
    const c = list.body.items.find((x: { targetId: string }) => x.targetId === l.id);
    expect((await moderator.post(`/admin/complaints/${c.id}/resolve`, { status: 'resolved', resolution: 'Мошенничество подтверждено', blockTarget: true })).status).toBe(204);
    expect((await seller.get(`/listings/${l.id}`)).body.status).toBe('blocked');
    expect((await seller.post(`/listings/${l.id}/republish`)).status).toBe(409);
    const open = await moderator.get('/admin/complaints').query({ status: 'new' });
    expect(open.body.items.find((x: { targetId: string }) => x.targetId === l.id)).toBeUndefined();
    const notes = await reporters[0].get('/notifications');
    expect(notes.body.items.some((n: { type: string }) => n.type === 'complaint.resolved')).toBe(true);
  });

  it('blocking a user revokes access and hides listings', async () => {
    const bad = new Client(h);
    const creds = await bad.register();
    const l = await publishListing(bad);
    expect((await moderator.post(`/admin/users/${bad.userId}/block`, { reason: 'Спам' })).status).toBe(204);
    expect((await bad.get('/users/me')).status).toBe(401);
    const login = await new Client(h).login(creds.email, creds.password);
    expect(login.status).toBe(403);
    expect(login.body.code).toBe('account_blocked');
    expect((await new Client(h).get(`/listings/${l.id}`)).status).toBe(404);
    expect((await moderator.post(`/admin/users/${admin.userId}/block`, { reason: 'test' })).status).toBe(403);
    const audit = await admin.get('/admin/audit').query({ entityType: 'user', entityId: bad.userId });
    expect(audit.body.items[0].action).toBe('user.block');
    expect(audit.body.items[0].ip).toBeTruthy();
  });

  it('categories and attributes are managed via admin and drive the public form', async () => {
    const slug = `test-cat-${Date.now()}`;
    const root = await admin.post('/admin/categories', { slug, name: 'Тестовая категория', vertical: 'goods' });
    expect(root.status).toBe(201);
    const attr = await admin.post('/admin/attributes', { key: `material_${Date.now()}`, name: 'Материал', type: 'enum', options: [{ value: 'wood', label: 'Дерево' }, { value: 'metal', label: 'Металл' }] });
    expect(attr.status).toBe(201);
    expect((await admin.put(`/admin/categories/${root.body.id}/attributes`, { attributeId: attr.body.id, isRequired: true })).status).toBe(204);
    const pub = await new Client(h).get(`/categories/${root.body.id}/attributes`);
    expect(pub.body[0].options.map((o: { value: string }) => o.value)).toEqual(['wood', 'metal']);
    expect(pub.body[0].isRequired).toBe(true);
    const tree = await new Client(h).get('/categories');
    expect(tree.body.some((c: { slug: string }) => c.slug === slug)).toBe(true);
    expect((await admin.patch(`/admin/categories/${root.body.id}`, { isActive: false })).status).toBe(200);
    expect((await new Client(h).get('/categories')).body.some((c: { slug: string }) => c.slug === slug)).toBe(false);
    const audit = await admin.get('/admin/audit').query({ entityType: 'category' });
    expect(audit.body.items.map((a: { action: string }) => a.action)).toEqual(expect.arrayContaining(['category.create', 'category.update']));
  });

  it('tariffs and settings are configurable; dashboard and analytics compute', async () => {
    const services = await admin.get('/admin/services');
    const bump = services.body.find((s: { code: string }) => s.code === 'bump_1');
    const upd = await finance.patch(`/admin/services/${bump.id}`, { ...bump, price: 12900 });
    expect(upd.body.price).toBe(12900);
    expect((await new Client(h).get('/billing/services')).body.find((s: { code: string }) => s.code === 'bump_1').price).toBe(12900);
    await finance.patch(`/admin/services/${bump.id}`, bump);
    expect((await admin.put('/admin/settings/orders.commission_bp', { value: 'много' })).status).toBe(400);
    expect((await admin.put('/admin/settings/orders.commission_bp', { value: 300 })).status).toBe(200);
    const dash = await admin.get('/admin/dashboard');
    expect(dash.body.users.active).toBeGreaterThan(0);
    const an = await admin.get('/admin/analytics').query({ days: 7 });
    expect(an.body.daily).toHaveLength(7);
    await admin.put('/admin/settings/orders.commission_bp', { value: 500 });
  });

  it('ad placements require ОРД marking (erid)', async () => {
    const base = { slot: 'home_top', title: 'Реклама', imageUrl: 'https://example.com/a.png', targetUrl: 'https://example.com', advertiser: 'ООО Ромашка', advertiserInn: '7707083893', startsAt: new Date(Date.now() - 1000).toISOString(), endsAt: new Date(Date.now() + 86400000).toISOString() };
    expect((await admin.post('/admin/ads', base)).status).toBe(400);
    const ad = await admin.post('/admin/ads', { ...base, erid: 'LjN8KTEST1' });
    expect(ad.status).toBe(201);
    const pub = await new Client(h).get('/billing/ads').query({ slot: 'home_top' });
    expect(pub.body[0].erid).toBe('LjN8KTEST1');
    const click = await new Client(h).post(`/billing/ads/${ad.body.id}/click`);
    expect(click.body.url).toContain('erid=LjN8KTEST1');
  });

  it('exposes health, readiness and metrics', async () => {
    expect((await h.http.get('/health/live')).status).toBe(200);
    const ready = await h.http.get('/health/ready');
    expect(ready.status).toBe(200);
    expect(ready.body.checks.every((c: { ok: boolean }) => c.ok)).toBe(true);
    const m = await h.http.get('/metrics');
    expect(m.text).toContain('lotok_http_request_duration_seconds');
  });
});
