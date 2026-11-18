import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import Redis from 'ioredis';
import { permissionsForRoles, type Role } from '@lotok/shared';
import { CONFIG, type AppConfig } from '../../config/config';
import { DB, type Db } from '../../database/database.module';
import { userRoles, users } from '../../database/schema';
import { REDIS } from '../../infra/redis.module';
import type { AuthUser } from '../../common/auth.decorators';

export interface AccessTokenPayload {
  sub: string;
  sid: string;
  tv: number;
}

interface CachedAuthState {
  tv: number;
  status: string;
  blockedUntil: string | null;
  roles: Role[];
}

/**
 * Проверка access-токена и актуального состояния пользователя.
 * Состояние (версия токенов, статус, роли) кэшируется в Redis на 60 с и сбрасывается при изменениях,
 * поэтому блокировка и «выход со всех устройств» действуют сразу.
 */
@Injectable()
export class AuthStateService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly jwt: JwtService,
  ) {}

  signAccess(payload: AccessTokenPayload): string {
    return this.jwt.sign(payload, { secret: this.config.JWT_ACCESS_SECRET, expiresIn: this.config.JWT_ACCESS_TTL_SEC, algorithm: 'HS256' });
  }

  async verify(token: string): Promise<AuthUser | null> {
    let payload: AccessTokenPayload;
    try {
      payload = this.jwt.verify<AccessTokenPayload>(token, { secret: this.config.JWT_ACCESS_SECRET, algorithms: ['HS256'] });
    } catch {
      return null;
    }
    if (await this.redis.exists(`revoked-sid:${payload.sid}`)) return null;
    const state = await this.getState(payload.sub);
    if (!state || state.tv !== payload.tv) return null;
    if (state.status !== 'active') {
      if (!(state.status === 'blocked' && state.blockedUntil && new Date(state.blockedUntil) < new Date())) return null;
    }
    return { id: payload.sub, roles: state.roles, permissions: permissionsForRoles(state.roles), sessionId: payload.sid };
  }

  async getState(userId: string): Promise<CachedAuthState | null> {
    const key = `auth-state:${userId}`;
    const cached = await this.redis.get(key);
    if (cached) return JSON.parse(cached) as CachedAuthState;
    const [u] = await this.db
      .select({ tv: users.tokenVersion, status: users.status, blockedUntil: users.blockedUntil })
      .from(users)
      .where(eq(users.id, userId));
    if (!u) return null;
    const roles = await this.db.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, userId));
    const state: CachedAuthState = {
      tv: u.tv,
      status: u.status,
      blockedUntil: u.blockedUntil ? u.blockedUntil.toISOString() : null,
      roles: roles.map((r) => r.role),
    };
    await this.redis.set(key, JSON.stringify(state), 'EX', 60);
    return state;
  }

  async invalidate(userId: string) {
    await this.redis.del(`auth-state:${userId}`);
  }

  /** Немедленно отзывает access-токены сессии (до истечения их TTL). */
  async revokeSessionAccess(sessionId: string) {
    await this.redis.set(`revoked-sid:${sessionId}`, '1', 'EX', this.config.JWT_ACCESS_TTL_SEC + 5);
  }
}
