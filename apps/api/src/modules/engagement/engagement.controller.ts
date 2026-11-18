import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { paginationQuery, savedSearchSchema } from '@lotok/shared';
import { z } from 'zod';
import { CurrentUser, OptionalUser, Public, type AuthUser } from '../../common/auth.decorators';
import { intParam, uuidParam, ZBody, ZQuery } from '../../common/zod';
import { EngagementService } from './engagement.service';

@ApiTags('engagement')
@ApiBearerAuth()
@Controller({ version: '1' })
export class EngagementController {
  constructor(private readonly svc: EngagementService) {}

  @Get('favorites')
  favorites(@CurrentUser() user: AuthUser, @ZQuery(paginationQuery) q: z.infer<typeof paginationQuery>) {
    return this.svc.listFavorites(user.id, q.page, q.limit);
  }

  @Get('favorites/ids')
  favoriteIds(@CurrentUser() user: AuthUser) {
    return this.svc.favoriteIds(user.id);
  }

  @Post('favorites/:listingId')
  @HttpCode(204)
  async addFavorite(@CurrentUser() user: AuthUser, @Param('listingId') id: string) {
    await this.svc.addFavorite(user.id, uuidParam.parse(id));
  }

  @Delete('favorites/:listingId')
  @HttpCode(204)
  async removeFavorite(@CurrentUser() user: AuthUser, @Param('listingId') id: string) {
    await this.svc.removeFavorite(user.id, uuidParam.parse(id));
  }

  @Get('saved-searches')
  saved(@CurrentUser() user: AuthUser) {
    return this.svc.listSaved(user.id);
  }

  @Post('saved-searches')
  createSaved(@CurrentUser() user: AuthUser, @ZBody(savedSearchSchema) body: z.infer<typeof savedSearchSchema>) {
    return this.svc.createSaved(user.id, body as { name: string; query: Record<string, unknown>; notify: boolean });
  }

  @Patch('saved-searches/:id')
  updateSaved(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const patch = z.object({ name: z.string().trim().min(1).max(120).optional(), notify: z.boolean().optional(), viewed: z.boolean().optional() }).parse(body ?? {});
    return this.svc.updateSaved(user.id, uuidParam.parse(id), patch);
  }

  @Delete('saved-searches/:id')
  @HttpCode(204)
  async deleteSaved(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.svc.deleteSaved(user.id, uuidParam.parse(id));
  }

  @Public()
  @Get('recommendations')
  recommendations(@OptionalUser() user: AuthUser | null, @Query('cityId') cityId?: string) {
    return this.svc.recommendations(user?.id ?? null, cityId ? intParam.parse(cityId) : null);
  }

  @Get('recently-viewed')
  recent(@CurrentUser() user: AuthUser) {
    return this.svc.recentlyViewed(user.id);
  }

  @Delete('recently-viewed')
  @HttpCode(204)
  async clear(@CurrentUser() user: AuthUser) {
    await this.svc.clearHistory(user.id);
  }
}
