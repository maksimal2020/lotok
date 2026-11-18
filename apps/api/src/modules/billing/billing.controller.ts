import { Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { paginationQuery, purchaseServiceSchema } from '@lotok/shared';
import { z } from 'zod';
import { CurrentUser, Public, RateLimit, type AuthUser } from '../../common/auth.decorators';
import { uuidParam, ZBody, ZQuery } from '../../common/zod';
import { AdsService } from './ads.service';
import { BillingService } from './billing.service';

@ApiTags('billing')
@ApiBearerAuth()
@Controller({ path: 'billing', version: '1' })
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly ads: AdsService,
  ) {}

  @Public()
  @Get('services')
  services(@Query('listingId') listingId?: string) {
    return this.billing.catalog({ listingId: listingId ? uuidParam.parse(listingId) : undefined });
  }

  @Post('purchases')
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @RateLimit({ name: 'purchase', limit: 60, windowSec: 3600, by: 'user' })
  purchase(@CurrentUser() user: AuthUser, @ZBody(purchaseServiceSchema) body: z.infer<typeof purchaseServiceSchema>, @Headers('idempotency-key') key?: string) {
    return this.billing.purchase(user.id, body, z.string().min(8).max(80).regex(/^[A-Za-z0-9_-]+$/).optional().parse(key) ?? null);
  }

  @Get('purchases')
  purchases(@CurrentUser() user: AuthUser, @ZQuery(paginationQuery) q: z.infer<typeof paginationQuery>) {
    return this.billing.listPurchases(user.id, q.page, q.limit);
  }

  @Get('purchases/:id')
  getPurchase(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.billing.getPurchase(user.id, uuidParam.parse(id));
  }

  @Get('quotas')
  quotas(@CurrentUser() user: AuthUser) {
    return this.billing.quotas(user.id);
  }

  @Public()
  @Get('ads')
  activeAds(@Query('slot') slot = 'home_top') {
    return this.ads.active(z.string().max(40).parse(slot));
  }

  @Public()
  @Post('ads/:id/click')
  click(@Param('id') id: string) {
    return this.ads.click(uuidParam.parse(id));
  }
}
