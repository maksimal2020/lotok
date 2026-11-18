import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permission, Role } from '@lotok/shared';
import type { Request } from 'express';

export interface AuthUser {
  id: string;
  roles: Role[];
  permissions: Set<Permission>;
  sessionId: string;
}

export type AuthedRequest = Request & { user?: AuthUser; id?: string };

export const IS_PUBLIC = 'isPublic';
/** Маршрут доступен без авторизации (пользователь подставится, если токен валиден). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const PERMISSIONS_KEY = 'permissions';
/** Требуемые права администратора (проверяются на backend). */
export const RequirePermissions = (...perms: Permission[]) => SetMetadata(PERMISSIONS_KEY, perms);

export interface RateLimitRule {
  name: string;
  limit: number;
  windowSec: number;
  by?: 'ip' | 'user';
}
export const RATE_LIMIT_KEY = 'rateLimit';
export const RateLimit = (rule: RateLimitRule) => SetMetadata(RATE_LIMIT_KEY, rule);

export const CurrentUser = createParamDecorator((_d: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  return req.user as AuthUser;
});

/** Пользователь или null (для публичных маршрутов). */
export const OptionalUser = createParamDecorator((_d: unknown, ctx: ExecutionContext): AuthUser | null => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  return req.user ?? null;
});

export interface ClientInfo {
  ip: string | null;
  userAgent: string | null;
}
export const Client = createParamDecorator((_d: unknown, ctx: ExecutionContext): ClientInfo => {
  const req = ctx.switchToHttp().getRequest<Request>();
  return { ip: req.ip ?? null, userAgent: (req.headers['user-agent'] ?? '').slice(0, 400) || null };
});
