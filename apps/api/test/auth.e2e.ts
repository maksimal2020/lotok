import { sql } from 'drizzle-orm';
import { Client, createHarness, type Harness } from './harness';

describe('Auth & sessions', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h.close());

  it('registers, verifies email and returns profile', async () => {
    const c = new Client(h);
    await c.register();
    const me = await c.get('/users/me');
    expect(me.status).toBe(200);
    expect(me.body.emailVerified).toBe(true);
    expect(me.body.roles).toEqual([]);
  });

  it('rejects duplicate email and weak password', async () => {
    const c = new Client(h);
    const { email } = await c.register({ verify: false });
    const dup = await new Client(h).post('/auth/register', { email, password: 'Passw0rd!', displayName: 'Дубль', acceptTerms: true, acceptPersonalData: true });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('email_taken');
    const weak = await new Client(h).post('/auth/register', { email: 'weak@test.local', password: 'short', displayName: 'Слабый', acceptTerms: true, acceptPersonalData: true });
    expect(weak.status).toBe(400);
    expect(weak.body.code).toBe('validation_error');
  });

  it('requires consent to personal data processing', async () => {
    const r = await new Client(h).post('/auth/register', { email: 'noconsent@test.local', password: 'Passw0rd!', displayName: 'Без согласия', acceptTerms: true });
    expect(r.status).toBe(400);
  });

  it('stores password hashed (argon2id), never in plain text', async () => {
    const c = new Client(h);
    const { email } = await c.register();
    const { rows } = await h.db.execute<{ password_hash: string }>(sql.raw(`SELECT password_hash FROM users WHERE email = '${email}'`));
    expect(rows[0].password_hash.startsWith('$argon2id$')).toBe(true);
  });

  it('locks login after repeated failures (brute-force protection)', async () => {
    const c = new Client(h);
    const { email } = await c.register();
    const attacker = new Client(h);
    for (let i = 0; i < 5; i++) {
      const r = await attacker.post('/auth/login', { email, password: 'Wrong1234' });
      expect(r.status).toBe(401);
    }
    const locked = await attacker.post('/auth/login', { email, password: 'Passw0rd!' });
    expect(locked.status).toBe(429);
    expect(locked.headers['retry-after']).toBeDefined();
  });

  it('rotates refresh tokens and detects reuse', async () => {
    const c = new Client(h);
    await c.register();
    const first = c.refreshToken!;
    const r1 = await c.post('/auth/refresh', { refreshToken: first });
    expect(r1.status).toBe(200);
    expect(r1.body.refreshToken).not.toBe(first);
    // Сдвигаем «время ротации» за пределы окна гонки, чтобы проверить обнаружение повторного использования.
    await h.db.execute(sql.raw(`UPDATE sessions SET last_used_at = now() - interval '5 minutes' WHERE user_id = '${c.userId}'`));
    const reuse = await c.post('/auth/refresh', { refreshToken: first });
    expect(reuse.status).toBe(401);
    // Вся сессия отозвана — новый токен тоже недействителен.
    const after = await c.post('/auth/refresh', { refreshToken: r1.body.refreshToken });
    expect(after.status).toBe(401);
  });

  it('web clients get httpOnly refresh cookie and must pass CSRF check', async () => {
    const c = new Client(h, 'web');
    const email = `web-${Date.now()}@test.local`;
    const r = await c.post('/auth/register', { email, password: 'Passw0rd!', displayName: 'Веб', acceptTerms: true, acceptPersonalData: true });
    expect(r.status).toBe(201);
    expect(r.body.refreshToken).toBeUndefined();
    const cookies = ([] as string[]).concat(r.headers['set-cookie'] as unknown as string[]);
    const rt = cookies.find((x) => x.startsWith('lotok_rt='))!;
    expect(rt).toMatch(/HttpOnly/);
    expect(rt).toMatch(/SameSite=Strict/);
    const csrf = cookies.find((x) => x.startsWith('lotok_csrf='))!.split(';')[0].split('=')[1];
    const cookieHeader = cookies.map((x) => x.split(';')[0]).join('; ');
    const noCsrf = await c.req('post', '/auth/refresh').set('Cookie', cookieHeader).send({});
    expect(noCsrf.status).toBe(403);
    const ok = await c.req('post', '/auth/refresh').set('Cookie', cookieHeader).set('X-CSRF-Token', csrf).send({});
    expect(ok.status).toBe(200);
  });

  it('logout-all invalidates access tokens immediately', async () => {
    const c = new Client(h);
    await c.register();
    const second = new Client(h);
    second.token = (await second.post('/auth/login', { email: (await h.db.execute<{ email: string }>(sql.raw(`SELECT email FROM users WHERE id='${c.userId}'`))).rows[0].email, password: 'Passw0rd!' })).body.accessToken;
    expect((await second.get('/users/me')).status).toBe(200);
    expect((await c.post('/auth/logout-all')).status).toBe(204);
    expect((await second.get('/users/me')).status).toBe(401);
    expect((await c.get('/users/me')).status).toBe(401);
  });

  it('lists and revokes individual sessions', async () => {
    const c = new Client(h);
    const { email, password } = await c.register();
    const other = new Client(h);
    await other.login(email, password);
    const list = await c.get('/auth/sessions');
    expect(list.body.length).toBe(2);
    const target = list.body.find((s: { current: boolean }) => !s.current);
    expect((await c.del(`/auth/sessions/${target.id}`)).status).toBe(204);
    expect((await other.get('/users/me')).status).toBe(401);
    expect((await c.get('/users/me')).status).toBe(200);
  });

  it('logs in by SMS code and registers new phone users with consent', async () => {
    const phone = `+7999${Math.floor(1000000 + Math.random() * 8999999)}`;
    const c = new Client(h);
    expect((await c.post('/auth/phone/request', { phone })).status).toBe(200);
    const again = await c.post('/auth/phone/request', { phone });
    expect(again.status).toBe(429);
    const code = /(\d{6})/.exec(h.sms.outbox.filter((m) => m.to === phone).pop()!.text)![1];
    const noTerms = await c.post('/auth/phone/verify', { phone, code });
    expect(noTerms.status).toBe(422);
    expect(noTerms.body.code).toBe('terms_required');
    const wrong = await c.post('/auth/phone/verify', { phone, code: code === '000000' ? '111111' : '000000', acceptTerms: true });
    expect(wrong.status).toBe(400);
    const ok = await c.post('/auth/phone/verify', { phone, code, acceptTerms: true });
    expect(ok.status).toBe(200);
    expect(ok.body.isNew).toBe(true);
    expect(ok.body.user.phoneVerified).toBe(true);
  });

  it('resets password via emailed link and revokes sessions', async () => {
    const c = new Client(h);
    const { email } = await c.register();
    expect((await new Client(h).post('/auth/password/reset-request', { email })).status).toBe(204);
    // Ответ одинаковый для несуществующего email (без перечисления аккаунтов).
    expect((await new Client(h).post('/auth/password/reset-request', { email: 'nobody@test.local' })).status).toBe(204);
    const token = /token=([A-Za-z0-9_-]+)/.exec(h.mail.outbox.filter((m) => m.to === email && m.subject.includes('Восстановление')).pop()!.text)![1];
    expect((await new Client(h).post('/auth/password/reset', { token, password: 'NewPassw0rd' })).status).toBe(204);
    expect((await c.get('/users/me')).status).toBe(401);
    expect((await new Client(h).login(email, 'NewPassw0rd')).status).toBe(200);
    expect((await new Client(h).post('/auth/password/reset', { token, password: 'Another123' })).status).toBe(400);
  });

  it('rejects requests without token and with forged token', async () => {
    const c = new Client(h);
    expect((await c.get('/users/me')).status).toBe(401);
    c.token = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.forged';
    expect((await c.get('/users/me')).status).toBe(401);
  });
});
