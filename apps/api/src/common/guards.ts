import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permission } from '@lotok/shared';
import { AuthStateService } from '../modules/auth/auth-state.service';
import { RateLimitService } from '../infra/redis.module';
import { IS_PUBLIC, PERMISSIONS_KEY, RATE_LIMIT_KEY, type AuthedRequest, type RateLimitRule } from './auth.decorators';
import { Errors } from './errors';

/** Глобальный guard: по умолчанию все маршруты требуют авторизации. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authState: AuthStateService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    if (token) {
      const user = await this.authState.verify(token);
      if (user) req.user = user;
      else if (!isPublic) throw Errors.unauthorized('Сессия истекла, войдите снова', 'token_invalid');
    }
    if (!isPublic && !req.user) throw Errors.unauthorized();
    return true;
  }
}

/** Проверка прав администраторских ролей (RBAC). */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!required?.length) return true;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (!req.user) throw Errors.unauthorized();
    const missing = required.filter((p) => !req.user!.permissions.has(p));
    if (missing.length) throw Errors.forbidden(`Недостаточно прав: ${missing.join(', ')}`);
    return true;
  }
}

/**
 * Ограничение частоты запросов: общий лимит на IP + именованные лимиты на маршрутах.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimitService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const ip = req.ip ?? 'unknown';
    const global = await this.limiter.hit(`global:${ip}`, 600, 60);
    if (!global.allowed) throw Errors.tooMany(global.retryAfterSec);
    const rule = this.reflector.getAllAndOverride<RateLimitRule>(RATE_LIMIT_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (rule) {
      const subject = rule.by === 'user' && req.user ? `u:${req.user.id}` : `ip:${ip}`;
      const r = await this.limiter.hit(`${rule.name}:${subject}`, rule.limit, rule.windowSec);
      if (!r.allowed) throw Errors.tooMany(r.retryAfterSec);
    }
    return true;
  }
}
