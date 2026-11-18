import { Global, Inject, Injectable, Module, OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { CONFIG, type AppConfig } from '../config/config';

export const REDIS = Symbol('REDIS');

@Injectable()
class RedisCloser implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}
  async onApplicationShutdown() {
    await this.redis.quit().catch(() => undefined);
  }
}

@Injectable()
export class RateLimitService {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Фиксированное окно на Redis (INCR + EXPIRE). Возвращает разрешён ли запрос.
   * Работает одинаково для всех реплик API.
   */
  async hit(key: string, limit: number, windowSec: number): Promise<{ allowed: boolean; remaining: number; retryAfterSec: number }> {
    const effective = Math.max(1, Math.floor(limit * this.config.RATE_LIMIT_MULTIPLIER));
    const k = `rl:${key}`;
    const res = await this.redis.multi().incr(k).expire(k, windowSec, 'NX').ttl(k).exec();
    const count = Number(res?.[0]?.[1] ?? 0);
    const ttl = Number(res?.[2]?.[1] ?? windowSec);
    return { allowed: count <= effective, remaining: Math.max(0, effective - count), retryAfterSec: ttl > 0 ? ttl : windowSec };
  }

  async peek(key: string): Promise<number> {
    return Number((await this.redis.get(`rl:${key}`)) ?? 0);
  }

  async reset(key: string) {
    await this.redis.del(`rl:${key}`);
  }
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [CONFIG],
      useFactory: (c: AppConfig) => new Redis(c.REDIS_URL, { maxRetriesPerRequest: 3, enableReadyCheck: true, lazyConnect: false }),
    },
    RedisCloser,
    RateLimitService,
  ],
  exports: [REDIS, RateLimitService],
})
export class RedisModule {}
