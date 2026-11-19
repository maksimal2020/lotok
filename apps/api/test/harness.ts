import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/bootstrap';
import { loadConfig, type AppConfig } from '../src/config/config';
import { DB, type Db } from '../src/database/database.module';
import { categories, regions, users } from '../src/database/schema';
import { JobsService } from '../src/infra/jobs.service';
import { MailService, PushService, SmsService } from '../src/infra/messaging.providers';
import { TEST_ENV } from './env';
import { SearchService } from '../src/modules/search/search.service';

export interface Harness {
  app: NestExpressApplication;
  config: AppConfig;
  db: Db;
  http: ReturnType<typeof request>;
  mail: MailService;
  sms: SmsService;
  push: PushService;
  jobs: JobsService;
  url: string;
  close(): Promise<void>;
}

export async function createHarness(overrides: Record<string, string> = {}): Promise<Harness> {
  Object.assign(process.env, TEST_ENV, overrides);
  const config = loadConfig({ ...TEST_ENV, ...overrides });
  const app = await createApp(config);
  if (config.SEARCH_DRIVER === 'opensearch') await app.get(SearchService).engine.ensureIndex();
  await app.listen(0, '127.0.0.1');
  const addr = app.getHttpServer().address() as { port: number };
  return {
    app,
    config,
    db: app.get<Db>(DB),
    http: request(app.getHttpServer()),
    mail: app.get(MailService),
    sms: app.get(SmsService),
    push: app.get(PushService),
    jobs: app.get(JobsService),
    url: `http://127.0.0.1:${addr.port}`,
    close: () => app.close(),
  };
}

let ipCounter = Math.floor(Math.random() * 200);
/** Уникальный IP на клиента — изоляция лимитов запросов между тестами. */
export function nextIp() {
  ipCounter++;
  return `10.${Math.floor(Math.random() * 250)}.${Math.floor(ipCounter / 250) % 250}.${ipCounter % 250}`;
}

export class Client {
  token: string | null = null;
  refreshToken: string | null = null;
  userId: string | null = null;
  readonly ip = nextIp();
  constructor(
    readonly h: Harness,
    readonly platform: 'web' | 'ios' | 'android' = 'ios',
  ) {}

  req(method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string) {
    const r = this.h.http[method](`/api/v1${path}`).set('X-Forwarded-For', this.ip).set('X-Client-Platform', this.platform);
    return this.token ? r.set('Authorization', `Bearer ${this.token}`) : r;
  }
  get(path: string) {
    return this.req('get', path);
  }
  post(path: string, body?: object) {
    return this.req('post', path).send(body ?? {});
  }
  patch(path: string, body?: object) {
    return this.req('patch', path).send(body ?? {});
  }
  put(path: string, body?: object) {
    return this.req('put', path).send(body ?? {});
  }
  del(path: string) {
    return this.req('delete', path);
  }

  /** Регистрация + подтверждение email по ссылке из письма. */
  async register(opts: { verify?: boolean; name?: string } = {}) {
    const email = `u-${randomUUID().slice(0, 12)}@test.local`;
    const password = 'Passw0rd!';
    const r = await this.post('/auth/register', { email, password, displayName: opts.name ?? 'Тестовый Пользователь', acceptTerms: true, acceptPersonalData: true });
    if (r.status !== 201) throw new Error(`register failed ${r.status} ${JSON.stringify(r.body)}`);
    this.token = r.body.accessToken;
    this.refreshToken = r.body.refreshToken;
    this.userId = r.body.user.id;
    if (opts.verify !== false) {
      const mail = this.h.mail.outbox.filter((m) => m.to === email).pop()!;
      const token = /token=([A-Za-z0-9_-]+)/.exec(mail.text)![1];
      const v = await this.post('/auth/verify-email', { token });
      if (v.status !== 204) throw new Error(`verify failed ${v.status}`);
    }
    return { email, password };
  }

  async login(email: string, password: string) {
    const r = await this.post('/auth/login', { email, password });
    if (r.status === 200) {
      this.token = r.body.accessToken;
      this.refreshToken = r.body.refreshToken;
      this.userId = r.body.user.id;
    }
    return r;
  }
}

export async function staffClient(h: Harness, email: string) {
  const c = new Client(h);
  const r = await c.login(email, 'Admin12345');
  if (r.status !== 200) throw new Error(`staff login failed: ${JSON.stringify(r.body)}`);
  return c;
}

export async function categoryId(h: Harness, slug: string) {
  const [c] = await h.db.select({ id: categories.id }).from(categories).where(eq(categories.slug, slug));
  return c.id;
}

export async function cityId(h: Harness, slug: string) {
  const [c] = await h.db.select({ id: regions.id }).from(regions).where(eq(regions.slug, slug));
  return c.id;
}

export async function makeOld(h: Harness, userId: string) {
  await h.db.update(users).set({ createdAt: new Date(Date.now() - 10 * 86_400_000) }).where(eq(users.id, userId));
}

export async function jpeg(w = 800, h = 600, color = '#0E8C76') {
  return sharp({ create: { width: w, height: h, channels: 3, background: color } }).jpeg().toBuffer();
}

export async function uploadPhoto(c: Client, purpose = 'listing') {
  const r = await c.req('post', `/media?purpose=${purpose}`).attach('file', await jpeg(), 'photo.jpg');
  if (r.status !== 201) throw new Error(`upload failed ${r.status} ${JSON.stringify(r.body)}`);
  await c.h.jobs.drain();
  return r.body.id as string;
}

/** Публикует объявление в «Смартфоны» (автомодерация одобряет «старого» пользователя). */
export async function publishListing(c: Client, overrides: Record<string, unknown> = {}) {
  await makeOld(c.h, c.userId!);
  const photo = await uploadPhoto(c);
  const body = {
    categoryId: await categoryId(c.h, 'smartphones'),
    title: `Смартфон тестовый ${randomUUID().slice(0, 6)}`,
    description: 'Хорошее состояние, полный комплект.',
    price: 1000000,
    priceType: 'fixed',
    condition: 'used',
    cityId: await cityId(c.h, 'moskva'),
    lat: 55.75,
    lng: 37.61,
    deliveryAvailable: true,
    attributes: { phone_brand: 'samsung', storage_gb: '128' },
    mediaIds: [photo],
    ...overrides,
  };
  const created = await c.post('/listings', body);
  if (created.status !== 201) throw new Error(`create failed ${created.status} ${JSON.stringify(created.body)}`);
  const submitted = await c.post(`/listings/${created.body.id}/submit`);
  if (submitted.status !== 200) throw new Error(`submit failed ${submitted.status} ${JSON.stringify(submitted.body)}`);
  await c.h.jobs.drain();
  return submitted.body as { id: string; status: string; version: number; title: string };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
