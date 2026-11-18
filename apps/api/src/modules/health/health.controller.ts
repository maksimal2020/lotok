import { Controller, Get, Headers, Inject, Res, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import type { Response } from 'express';
import Redis from 'ioredis';
import { CONFIG, type AppConfig } from '../../config/config';
import { DB, type Db } from '../../database/database.module';
import { REDIS } from '../../infra/redis.module';
import { StorageService } from '../../infra/storage.service';
import { registry } from '../../infra/metrics';
import { Public } from '../../common/auth.decorators';
import { Errors } from '../../common/errors';
import { SEARCH_ENGINE, type SearchEngine } from '../search/search.types';

async function check(name: string, fn: () => Promise<unknown>) {
  const start = Date.now();
  try {
    await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000))]);
    return { name, ok: true, ms: Date.now() - start };
  } catch (e) {
    return { name, ok: false, ms: Date.now() - start, error: (e as Error).message };
  }
}

@ApiExcludeController()
@Public()
@Controller({ version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(SEARCH_ENGINE) private readonly search: SearchEngine,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly storage: StorageService,
  ) {}

  /** Liveness: процесс жив (без проверки зависимостей, чтобы не перезапускать под при сбое БД). */
  @Get('health/live')
  live() {
    return { status: 'ok' };
  }

  /** Readiness: все обязательные зависимости доступны. */
  @Get('health/ready')
  async ready(@Res({ passthrough: true }) res: Response) {
    const checks = await Promise.all([
      check('postgres', () => this.db.execute(sql`SELECT 1`)),
      check('redis', () => this.redis.ping()),
      check('search', () => this.search.ping()),
      check('storage', () => this.storage.ping()),
    ]);
    const ok = checks.every((c) => c.ok);
    res.status(ok ? 200 : 503);
    return { status: ok ? 'ok' : 'degraded', checks };
  }

  /** Метрики Prometheus. В production закрыты на уровне ingress и/или токеном. */
  @Get('metrics')
  async metrics(@Res() res: Response, @Headers('authorization') auth?: string) {
    if (this.config.METRICS_TOKEN && auth !== `Bearer ${this.config.METRICS_TOKEN}`) throw Errors.unauthorized();
    res.setHeader('Content-Type', registry.contentType);
    res.send(await registry.metrics());
  }
}
