import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { cursorQuery } from '@lotok/shared';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../../common/auth.decorators';
import { uuidParam, ZQuery } from '../../common/zod';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller({ path: 'notifications', version: '1' })
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @ZQuery(cursorQuery) q: z.infer<typeof cursorQuery>) {
    return this.notifications.list(user.id, q.cursor, q.limit);
  }

  @Get('unread-count')
  async unread(@CurrentUser() user: AuthUser) {
    return { count: await this.notifications.unreadCount(user.id) };
  }

  @Post('read')
  @HttpCode(204)
  async read(@CurrentUser() user: AuthUser, @Body() body: { ids?: unknown }) {
    const ids = body?.ids === 'all' ? 'all' : z.array(z.uuid()).max(200).parse(body?.ids ?? []);
    await this.notifications.markRead(user.id, ids);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.notifications.remove(user.id, uuidParam.parse(id));
  }
}
