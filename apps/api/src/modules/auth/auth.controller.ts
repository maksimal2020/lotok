import { Controller, Delete, Get, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  changePasswordSchema,
  loginSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  phoneRequestSchema,
  phoneVerifySchema,
  refreshSchema,
  registerSchema,
  resendVerificationSchema,
  verifyEmailSchema,
  attachPhoneSchema,
} from '@lotok/shared';
import type { z } from 'zod';
import { CONFIG, type AppConfig } from '../../config/config';
import { Client, CurrentUser, Public, RateLimit, type AuthUser, type ClientInfo } from '../../common/auth.decorators';
import { Errors } from '../../common/errors';
import { randomToken } from '../../common/util';
import { uuidParam, ZBody } from '../../common/zod';
import { UsersService } from '../users/users.service';
import { AuthService, type IssuedTokens } from './auth.service';

const RT_COOKIE = 'lotok_rt';
const CSRF_COOKIE = 'lotok_csrf';

@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /** Веб-клиенты получают refresh-токен в httpOnly cookie; мобильные (X-Client-Platform: ios|android) — в теле ответа. */
  private respond(req: Request, res: Response, t: IssuedTokens) {
    const platform = String(req.headers['x-client-platform'] ?? 'web');
    if (platform === 'ios' || platform === 'android') {
      return { accessToken: t.accessToken, refreshToken: t.refreshToken, expiresIn: t.expiresIn, user: t.user };
    }
    this.setCookies(res, t.refreshToken);
    return { accessToken: t.accessToken, expiresIn: t.expiresIn, user: t.user };
  }

  private setCookies(res: Response, refreshToken: string) {
    const base = { secure: this.config.COOKIE_SECURE, domain: this.config.COOKIE_DOMAIN };
    res.cookie(RT_COOKIE, refreshToken, {
      ...base,
      httpOnly: true,
      sameSite: 'strict',
      path: '/api/v1/auth',
      maxAge: this.config.REFRESH_TTL_DAYS * 86_400_000,
    });
    res.cookie(CSRF_COOKIE, randomToken(16), { ...base, httpOnly: false, sameSite: 'strict', path: '/', maxAge: this.config.REFRESH_TTL_DAYS * 86_400_000 });
  }

  private clearCookies(res: Response) {
    res.clearCookie(RT_COOKIE, { path: '/api/v1/auth', domain: this.config.COOKIE_DOMAIN });
    res.clearCookie(CSRF_COOKIE, { path: '/', domain: this.config.COOKIE_DOMAIN });
  }

  /** Двойная отправка CSRF-токена для операций, авторизуемых cookie. */
  private refreshTokenFrom(req: Request, bodyToken?: string): string {
    if (bodyToken) return bodyToken;
    const cookieToken = req.cookies?.[RT_COOKIE] as string | undefined;
    if (!cookieToken) throw Errors.unauthorized('Сессия не найдена', 'session_invalid');
    const csrfCookie = req.cookies?.[CSRF_COOKIE];
    const csrfHeader = req.headers['x-csrf-token'];
    if (!csrfCookie || csrfCookie !== csrfHeader) throw Errors.forbidden('CSRF-проверка не пройдена', 'csrf_failed');
    return cookieToken;
  }

  @Public()
  @Post('register')
  @RateLimit({ name: 'register', limit: 10, windowSec: 3600 })
  async register(
    @ZBody(registerSchema) body: z.infer<typeof registerSchema>,
    @Client() client: ClientInfo,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const t = await this.auth.register(body, { client, platform: platformOf(req) });
    return this.respond(req, res, t);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @RateLimit({ name: 'login', limit: 30, windowSec: 900 })
  async login(
    @ZBody(loginSchema) body: z.infer<typeof loginSchema>,
    @Client() client: ClientInfo,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const t = await this.auth.login(body, { client, platform: body.platform ?? platformOf(req), deviceName: body.deviceName });
    return this.respond(req, res, t);
  }

  @Public()
  @Post('verify-email')
  @HttpCode(204)
  @RateLimit({ name: 'verify-email', limit: 20, windowSec: 3600 })
  async verifyEmail(@ZBody(verifyEmailSchema) body: z.infer<typeof verifyEmailSchema>) {
    await this.auth.verifyEmail(body.token);
  }

  @Public()
  @Post('resend-verification')
  @HttpCode(204)
  @RateLimit({ name: 'resend-verification', limit: 3, windowSec: 3600 })
  async resend(@ZBody(resendVerificationSchema) body: z.infer<typeof resendVerificationSchema>, @Client() client: ClientInfo) {
    await this.auth.resendVerification(body.email, client);
  }

  @Public()
  @Post('phone/request')
  @HttpCode(200)
  async phoneRequest(@ZBody(phoneRequestSchema) body: z.infer<typeof phoneRequestSchema>, @Client() client: ClientInfo) {
    return this.auth.requestPhoneCode(body.phone, client);
  }

  @Public()
  @Post('phone/verify')
  @HttpCode(200)
  @RateLimit({ name: 'phone-verify', limit: 20, windowSec: 900 })
  async phoneVerify(
    @ZBody(phoneVerifySchema) body: z.infer<typeof phoneVerifySchema>,
    @Client() client: ClientInfo,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const t = await this.auth.verifyPhoneLogin(body, { client, platform: body.platform ?? platformOf(req), deviceName: body.deviceName });
    return { ...this.respond(req, res, t), isNew: t.isNew };
  }

  @Public()
  @Post('password/reset-request')
  @HttpCode(204)
  @RateLimit({ name: 'password-reset', limit: 5, windowSec: 3600 })
  async resetRequest(@ZBody(passwordResetRequestSchema) body: z.infer<typeof passwordResetRequestSchema>, @Client() client: ClientInfo) {
    await this.auth.requestPasswordReset(body.email, client);
  }

  @Public()
  @Post('password/reset')
  @HttpCode(204)
  @RateLimit({ name: 'password-reset-confirm', limit: 10, windowSec: 3600 })
  async reset(@ZBody(passwordResetConfirmSchema) body: z.infer<typeof passwordResetConfirmSchema>, @Client() client: ClientInfo) {
    await this.auth.resetPassword(body.token, body.password, client);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @RateLimit({ name: 'refresh', limit: 120, windowSec: 900 })
  async refresh(
    @ZBody(refreshSchema) body: z.infer<typeof refreshSchema>,
    @Client() client: ClientInfo,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = this.refreshTokenFrom(req, body.refreshToken);
    try {
      const r = await this.auth.refresh(token, client);
      if (r.accessOnly) return r.accessOnly;
      return this.respond(req, res, r.tokens!);
    } catch (e) {
      if (!body.refreshToken) this.clearCookies(res);
      throw e;
    }
  }

  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    await this.auth.revokeSession(user.id, user.sessionId);
    this.clearCookies(res);
  }

  @ApiBearerAuth()
  @Post('logout-all')
  @HttpCode(204)
  async logoutAll(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    await this.auth.revokeAll(user.id);
    this.clearCookies(res);
  }

  @ApiBearerAuth()
  @Get('sessions')
  sessions(@CurrentUser() user: AuthUser) {
    return this.users.listSessions(user.id, user.sessionId);
  }

  @ApiBearerAuth()
  @Delete('sessions/:id')
  @HttpCode(204)
  async revoke(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const ok = await this.auth.revokeSession(user.id, uuidParam.parse(id), 'revoked_by_user');
    if (!ok) throw Errors.notFound('Сессия');
  }

  @ApiBearerAuth()
  @Post('password/change')
  @HttpCode(204)
  async changePassword(@CurrentUser() user: AuthUser, @ZBody(changePasswordSchema) body: z.infer<typeof changePasswordSchema>) {
    await this.auth.changePassword(user.id, user.sessionId, body.currentPassword, body.newPassword);
  }

  @ApiBearerAuth()
  @Post('phone/attach/request')
  @HttpCode(200)
  async attachRequest(@CurrentUser() user: AuthUser, @ZBody(phoneRequestSchema) body: z.infer<typeof phoneRequestSchema>, @Client() client: ClientInfo) {
    return this.auth.requestPhoneCode(body.phone, client, 'phone_attach', user.id);
  }

  @ApiBearerAuth()
  @Post('phone/attach')
  @RateLimit({ name: 'phone-attach', limit: 20, windowSec: 900, by: 'user' })
  async attach(@CurrentUser() user: AuthUser, @ZBody(attachPhoneSchema) body: z.infer<typeof attachPhoneSchema>) {
    await this.auth.attachPhone(user.id, body.phone, body.code);
    return this.users.getMe(user.id);
  }
}

function platformOf(req: Request): 'web' | 'ios' | 'android' {
  const p = String(req.headers['x-client-platform'] ?? 'web');
  return p === 'ios' || p === 'android' ? p : 'web';
}
