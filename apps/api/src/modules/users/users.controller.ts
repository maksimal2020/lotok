import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { notificationPreferencesSchema, pushTokenSchema, updateProfileSchema } from '@lotok/shared';
import type { z } from 'zod';
import { CurrentUser, Public, type AuthUser } from '../../common/auth.decorators';
import { uuidParam, ZBody } from '../../common/zod';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller({ path: 'users', version: '1' })
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.users.getMe(user.id);
  }

  @Patch('me')
  update(@CurrentUser() user: AuthUser, @ZBody(updateProfileSchema) body: z.infer<typeof updateProfileSchema>) {
    return this.users.updateProfile(user.id, body);
  }

  @Delete('me')
  @HttpCode(204)
  async deleteMe(@CurrentUser() user: AuthUser) {
    await this.users.deleteAccount(user.id);
  }

  @Get('me/notification-preferences')
  prefs(@CurrentUser() user: AuthUser) {
    return this.users.getPreferences(user.id);
  }

  @Put('me/notification-preferences')
  setPrefs(@CurrentUser() user: AuthUser, @ZBody(notificationPreferencesSchema) body: z.infer<typeof notificationPreferencesSchema>) {
    return this.users.setPreferences(user.id, body.preferences);
  }

  @Post('me/push-tokens')
  @HttpCode(204)
  async addPush(@CurrentUser() user: AuthUser, @ZBody(pushTokenSchema) body: z.infer<typeof pushTokenSchema>) {
    await this.users.registerPushToken(user.id, body.token, body.platform);
  }

  @Delete('me/push-tokens')
  @HttpCode(204)
  async removePush(@CurrentUser() user: AuthUser, @Body() body: { token?: string }) {
    if (body?.token) await this.users.removePushToken(user.id, String(body.token));
  }

  @Get('me/blocked')
  blocked(@CurrentUser() user: AuthUser) {
    return this.users.listBlocked(user.id);
  }

  @Post(':id/block')
  @HttpCode(204)
  async block(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.users.block(user.id, uuidParam.parse(id));
  }

  @Delete(':id/block')
  @HttpCode(204)
  async unblock(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.users.unblock(user.id, uuidParam.parse(id));
  }

  @Public()
  @Get(':id')
  publicProfile(@Param('id') id: string) {
    return this.users.getPublic(uuidParam.parse(id));
  }
}
