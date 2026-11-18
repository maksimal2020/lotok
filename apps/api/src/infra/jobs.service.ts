import { Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Queue, Worker, type JobsOptions } from 'bullmq';
import { CONFIG, type AppConfig } from '../config/config';

/**
 * Имена очередей и заданий. Очереди разделены по характеру нагрузки,
 * чтобы тяжёлая обработка изображений не задерживала уведомления.
 */
export const QUEUES = {
  media: ['media.process'],
  search: ['search.index', 'search.remove', 'search.reindex-stale'],
  notifications: ['notify.email', 'notify.push', 'notify.sms', 'notify.saved-searches'],
  payments: ['payments.mock-webhook', 'payments.reconcile'],
  maintenance: [
    'listings.expire',
    'promotions.expire',
    'promotions.daily-bump',
    'orders.auto-complete',
    'orders.cancel-unpaid',
    'stats.decay-interests',
  ],
} as const;

export type JobName = (typeof QUEUES)[keyof typeof QUEUES][number];
type Handler = (data: any) => Promise<unknown>;

function queueOf(job: JobName): keyof typeof QUEUES {
  for (const [q, jobs] of Object.entries(QUEUES)) if ((jobs as readonly string[]).includes(job)) return q as keyof typeof QUEUES;
  throw new Error(`Unknown job ${job}`);
}

function redisConnection(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    password: u.password ? decodeURIComponent(u.password) : undefined,
    username: u.username || undefined,
    db: Number(u.pathname.slice(1) || 0),
    maxRetriesPerRequest: null as null,
  };
}

/**
 * Фасад фоновых заданий. В режиме bullmq задания попадают в Redis и обрабатываются процессом worker.
 * В режиме inline (только тесты/локальная отладка) обработчик вызывается сразу в текущем процессе.
 */
@Injectable()
export class JobsService implements OnApplicationShutdown {
  private readonly logger = new Logger('Jobs');
  private readonly handlers = new Map<JobName, Handler>();
  private readonly queues = new Map<string, Queue>();
  private readonly workers: Worker[] = [];
  /** Задания inline-режима, ещё не завершившиеся (для тестов). */
  private readonly pending = new Set<Promise<unknown>>();

  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  register(job: JobName, handler: Handler) {
    this.handlers.set(job, handler);
  }

  private queue(name: string): Queue {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, {
        connection: redisConnection(this.config.REDIS_URL),
        defaultJobOptions: { attempts: 5, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: 1000, removeOnFail: 5000 },
      });
      this.queues.set(name, q);
    }
    return q;
  }

  async enqueue(job: JobName, data: Record<string, unknown>, opts: JobsOptions = {}) {
    if (this.config.QUEUE_MODE === 'inline') {
      const handler = this.handlers.get(job);
      if (!handler) {
        this.logger.warn(`No inline handler for ${job}`);
        return;
      }
      const p = handler(data)
        .catch((e) => this.logger.error({ err: e, job }, 'Inline job failed'))
        .finally(() => this.pending.delete(p));
      this.pending.add(p);
      return;
    }
    await this.queue(queueOf(job)).add(job, data, opts);
  }

  /** Ожидание завершения inline-заданий (используется в тестах). */
  async drain() {
    while (this.pending.size) await Promise.all([...this.pending]);
  }

  /** Запуск обработчиков (только в процессе worker). */
  startWorkers(concurrency: Partial<Record<keyof typeof QUEUES, number>> = {}) {
    for (const name of Object.keys(QUEUES) as (keyof typeof QUEUES)[]) {
      const worker = new Worker(
        name,
        async (job) => {
          const handler = this.handlers.get(job.name as JobName);
          if (!handler) throw new Error(`No handler for ${job.name}`);
          return handler(job.data);
        },
        { connection: redisConnection(this.config.REDIS_URL), concurrency: concurrency[name] ?? 4 },
      );
      worker.on('failed', (job, err) => this.logger.error({ err, job: job?.name, id: job?.id }, 'Job failed'));
      this.workers.push(worker);
    }
  }

  /** Периодические задания (идемпотентная регистрация расписаний). */
  async schedule(job: JobName, pattern: string) {
    if (this.config.QUEUE_MODE === 'inline') return;
    await this.queue(queueOf(job)).upsertJobScheduler(`cron:${job}`, { pattern }, { name: job, data: {} });
  }

  async ping(): Promise<boolean> {
    if (this.config.QUEUE_MODE === 'inline') return true;
    const client = await this.queue('maintenance').client;
    return (await client.ping()) === 'PONG';
  }

  async stats() {
    if (this.config.QUEUE_MODE === 'inline') return {};
    const out: Record<string, Record<string, number>> = {};
    for (const name of Object.keys(QUEUES)) out[name] = await this.queue(name).getJobCounts('waiting', 'active', 'failed', 'delayed');
    return out;
  }

  async onApplicationShutdown() {
    await Promise.all(this.workers.map((w) => w.close()));
    await Promise.all([...this.queues.values()].map((q) => q.close()));
  }
}
