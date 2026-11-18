import { Controller, Get, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { searchQuerySchema } from '@lotok/shared';
import { OptionalUser, Public, RateLimit, type AuthUser } from '../../common/auth.decorators';
import { SearchService } from './search.service';

/** Разбор query: attr.<key>=…, attr.<key>.min=… → attrs. */
export function parseSearchQuery(raw: Record<string, unknown>) {
  const attrs: Record<string, string> = {};
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k.startsWith('attr.')) attrs[k.slice(5)] = String(Array.isArray(v) ? v.join(',') : v);
    else rest[k] = v;
  }
  return searchQuerySchema.parse({ ...rest, attrs });
}

@ApiTags('search')
@Public()
@Controller({ path: 'search', version: '1' })
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  @RateLimit({ name: 'search', limit: 120, windowSec: 60 })
  find(@Req() req: Request, @OptionalUser() user: AuthUser | null) {
    return this.search.search(parseSearchQuery(req.query as Record<string, unknown>), user?.id ?? null);
  }

  @Get('suggest')
  @RateLimit({ name: 'suggest', limit: 300, windowSec: 60 })
  suggest(@Query('q') q = '') {
    return this.search.suggest(String(q));
  }

  @Get('map')
  @RateLimit({ name: 'search-map', limit: 60, windowSec: 60 })
  map(@Req() req: Request) {
    return this.search.mapPoints(parseSearchQuery(req.query as Record<string, unknown>));
  }
}
