import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { sendMessageSchema, startConversationSchema } from '@lotok/shared';
import { z } from 'zod';
import { CurrentUser, RateLimit, type AuthUser } from '../../common/auth.decorators';
import { uuidParam, ZBody } from '../../common/zod';
import { ChatService } from './chat.service';

@ApiTags('chat')
@ApiBearerAuth()
@Controller({ path: 'conversations', version: '1' })
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Post()
  @RateLimit({ name: 'conv-start', limit: 60, windowSec: 3600, by: 'user' })
  start(@CurrentUser() user: AuthUser, @ZBody(startConversationSchema) body: z.infer<typeof startConversationSchema>) {
    return this.chat.start(user.id, body.listingId, body.message);
  }

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('archived') archived?: string,
    @Query('q') q?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.chat.list(user.id, {
      archived: archived === 'true' || archived === '1',
      q: q?.trim() || undefined,
      cursor: cursor ? z.iso.datetime().parse(cursor) : undefined,
      limit: z.coerce.number().int().min(1).max(100).default(30).parse(limit ?? undefined),
    });
  }

  @Get('unread')
  unread(@CurrentUser() user: AuthUser) {
    return this.chat.unreadTotal(user.id);
  }

  @Get('search')
  search(@CurrentUser() user: AuthUser, @Query('q') q = '') {
    return this.chat.searchMessages(user.id, z.string().trim().min(2).max(200).parse(q));
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.chat.getConversation(user.id, uuidParam.parse(id));
  }

  @Get(':id/messages')
  messages(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('before') before?: string, @Query('limit') limit?: string) {
    return this.chat.messages(
      user.id,
      uuidParam.parse(id),
      before ? z.iso.datetime().parse(before) : undefined,
      z.coerce.number().int().min(1).max(100).default(50).parse(limit ?? undefined),
    );
  }

  @Post(':id/messages')
  send(@CurrentUser() user: AuthUser, @Param('id') id: string, @ZBody(sendMessageSchema) body: z.infer<typeof sendMessageSchema>) {
    return this.chat.send(user.id, uuidParam.parse(id), body);
  }

  @Post(':id/read')
  @HttpCode(204)
  async read(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.chat.markRead(user.id, uuidParam.parse(id));
  }

  @Post(':id/delivered')
  @HttpCode(204)
  async delivered(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.chat.markDelivered(user.id, uuidParam.parse(id));
  }

  @Post(':id/archive')
  @HttpCode(204)
  async archive(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.chat.setArchived(user.id, uuidParam.parse(id), true);
  }

  @Post(':id/unarchive')
  @HttpCode(204)
  async unarchive(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.chat.setArchived(user.id, uuidParam.parse(id), false);
  }
}
