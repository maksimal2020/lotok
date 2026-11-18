import { Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { createListingSchema, LISTING_STATUSES, paginationQuery, updateListingSchema } from '@lotok/shared';
import { z } from 'zod';
import { CurrentUser, OptionalUser, Public, RateLimit, type AuthUser } from '../../common/auth.decorators';
import { uuidParam, ZBody, ZQuery } from '../../common/zod';
import { UsersService } from '../users/users.service';
import { ListingsService } from './listings.service';
import { BillingQueries } from './billing-queries.service';

const mineQuery = paginationQuery.extend({ status: z.enum([...LISTING_STATUSES, 'all']).default('all') });

@ApiTags('listings')
@ApiBearerAuth()
@Controller({ path: 'listings', version: '1' })
export class ListingsController {
  constructor(
    private readonly listings: ListingsService,
    private readonly users: UsersService,
    private readonly billing: BillingQueries,
  ) {}

  @Post()
  @RateLimit({ name: 'listing-create', limit: 60, windowSec: 3600, by: 'user' })
  create(@CurrentUser() user: AuthUser, @ZBody(createListingSchema) body: z.infer<typeof createListingSchema>) {
    return this.listings.create(user.id, body);
  }

  @Get('mine')
  mine(@CurrentUser() user: AuthUser, @ZQuery(mineQuery) q: z.infer<typeof mineQuery>) {
    return this.listings.listMine(user.id, q.status, q.page, q.limit);
  }

  @Public()
  @Get('by-seller/:userId')
  bySeller(@Param('userId') userId: string, @ZQuery(paginationQuery) q: z.infer<typeof paginationQuery>, @OptionalUser() user: AuthUser | null) {
    return this.listings.listBySeller(uuidParam.parse(userId), q.page, q.limit, user?.id ?? null);
  }

  @Public()
  @Get(':id')
  async get(@Param('id') id: string, @OptionalUser() user: AuthUser | null) {
    return this.listings.getPublic(uuidParam.parse(id), user ? { id: user.id, canModerate: user.permissions.has('listings.read') } : null);
  }

  @Public()
  @Post(':id/view')
  @HttpCode(204)
  @RateLimit({ name: 'listing-view', limit: 600, windowSec: 3600 })
  async view(@Param('id') id: string, @OptionalUser() user: AuthUser | null, @Req() req: Request) {
    await this.listings.registerView(uuidParam.parse(id), { userId: user?.id ?? null, fingerprint: `${req.ip}|${req.headers['user-agent'] ?? ''}` });
  }

  @Get(':id/phone')
  @RateLimit({ name: 'phone-reveal', limit: 60, windowSec: 3600, by: 'user' })
  phone(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.listings.revealPhone(uuidParam.parse(id), user.id);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @ZBody(updateListingSchema) body: z.infer<typeof updateListingSchema>) {
    return this.listings.update(user.id, uuidParam.parse(id), body);
  }

  @Post(':id/submit')
  @HttpCode(200)
  submit(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.listings.submit(user.id, uuidParam.parse(id));
  }

  @Post(':id/republish')
  @HttpCode(200)
  republish(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.listings.republish(user.id, uuidParam.parse(id));
  }

  @Post(':id/unpublish')
  @HttpCode(200)
  unpublish(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.listings.ownerAction(user.id, uuidParam.parse(id), 'unpublish');
  }

  @Post(':id/sold')
  @HttpCode(200)
  sold(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.listings.ownerAction(user.id, uuidParam.parse(id), 'mark_sold');
  }

  @Post(':id/archive')
  @HttpCode(200)
  archive(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.listings.ownerAction(user.id, uuidParam.parse(id), 'archive');
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.listings.ownerAction(user.id, uuidParam.parse(id), 'delete');
  }

  @Get(':id/stats')
  async stats(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('extended') extended?: string) {
    const allowed = extended === '1' && (await this.billing.hasExtendedStats(user.id));
    return this.listings.stats(user.id, uuidParam.parse(id), allowed);
  }

  @Get(':id/history')
  history(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.listings.history(user.id, uuidParam.parse(id));
  }
}
