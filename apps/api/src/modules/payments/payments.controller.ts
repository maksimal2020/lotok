import { Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { paginationQuery } from '@lotok/shared';
import { z } from 'zod';
import { CurrentUser, Public, RateLimit, type AuthUser } from '../../common/auth.decorators';
import { uuidParam, ZBody, ZQuery } from '../../common/zod';
import { PaymentsService } from './payments.service';
import { LedgerService } from './ledger.service';

@ApiTags('payments')
@ApiBearerAuth()
@Controller({ path: 'payments', version: '1' })
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly ledger: LedgerService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @ZQuery(paginationQuery) q: z.infer<typeof paginationQuery>) {
    return this.payments.listForUser(user.id, q.page, q.limit);
  }

  /** История операций по бонусному счёту и начислениям продавцу. */
  @Get('ledger')
  async ledgerHistory(@CurrentUser() user: AuthUser) {
    const rows = await this.ledger.userHistory(user.id);
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.payments.getForUser(user.id, uuidParam.parse(id));
  }

  /** Принудительная проверка статуса после возврата со страницы оплаты. */
  @Post(':id/sync')
  @HttpCode(200)
  @RateLimit({ name: 'payment-sync', limit: 60, windowSec: 600, by: 'user' })
  async sync(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.payments.getForUser(user.id, uuidParam.parse(id));
    await this.payments.sync(id);
    return this.payments.getForUser(user.id, id);
  }

  /** Webhook платёжного провайдера. Тело читается «как есть» для проверки подписи. */
  @Public()
  @Post('webhooks/:provider')
  @HttpCode(200)
  @ApiExcludeEndpoint()
  async webhook(@Param('provider') provider: string, @Req() req: Request & { rawBody?: Buffer }) {
    if (provider !== this.payments.provider.name) return { ignored: true };
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    return this.payments.handleWebhook(raw, req.headers, req.ip ?? null);
  }

  /* ---------- тестовый провайдер (sandbox): страница оплаты ---------- */

  @Public()
  @Get('test/:providerPaymentId')
  testInfo(@Param('providerPaymentId') id: string) {
    return this.payments.mockInfo(z.string().max(100).parse(id));
  }

  @Public()
  @Post('test/:providerPaymentId/complete')
  @HttpCode(200)
  @RateLimit({ name: 'mock-pay', limit: 60, windowSec: 600 })
  testComplete(@Param('providerPaymentId') id: string, @ZBody(z.object({ outcome: z.enum(['succeeded', 'canceled']) })) body: { outcome: 'succeeded' | 'canceled' }) {
    return this.payments.mockComplete(z.string().max(100).parse(id), body.outcome);
  }
}
