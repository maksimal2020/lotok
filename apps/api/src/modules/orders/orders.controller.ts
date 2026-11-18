import { Controller, Get, Headers, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { createOrderSchema, deliveryQuoteSchema, ORDER_STATUSES, orderActionSchema, paginationQuery } from '@lotok/shared';
import { z } from 'zod';
import { CurrentUser, RateLimit, type AuthUser } from '../../common/auth.decorators';
import { uuidParam, ZBody, ZQuery } from '../../common/zod';
import { OrdersService } from './orders.service';

const listQuery = paginationQuery.extend({ role: z.enum(['buyer', 'seller']).default('buyer'), status: z.enum(ORDER_STATUSES).optional() });
const idemKey = z.string().min(8).max(80).regex(/^[A-Za-z0-9_-]+$/).optional();

@ApiTags('orders')
@ApiBearerAuth()
@Controller({ path: 'orders', version: '1' })
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @RateLimit({ name: 'order-create', limit: 30, windowSec: 3600, by: 'user' })
  create(@CurrentUser() user: AuthUser, @ZBody(createOrderSchema) body: z.infer<typeof createOrderSchema>, @Headers('idempotency-key') key?: string) {
    return this.orders.create(user.id, body, idemKey.parse(key) ?? null);
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @ZQuery(listQuery) q: z.infer<typeof listQuery>) {
    return this.orders.list(user.id, q.role, q.page, q.limit, q.status);
  }

  @Get('delivery/quote')
  quote(@Query() q: Record<string, string>) {
    const p = deliveryQuoteSchema.parse(q);
    return this.orders.quote(p.listingId, p.city);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orders.get(user.id, uuidParam.parse(id), false);
  }

  @Post(':id/:action')
  @HttpCode(200)
  act(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('action') action: string, @ZBody(orderActionSchema) body: z.infer<typeof orderActionSchema>) {
    return this.orders.action(user.id, uuidParam.parse(id), z.enum(['confirm', 'ship', 'deliver', 'complete', 'cancel', 'request_refund', 'approve_refund']).parse(action), body);
  }
}
