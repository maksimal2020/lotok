import { Controller, Delete, Get, HttpCode, Param, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentUser, Public, RateLimit, type AuthUser } from '../../common/auth.decorators';
import { uuidParam } from '../../common/zod';
import { MEDIA_PURPOSES, MediaService } from './media.service';

@ApiTags('media')
@ApiBearerAuth()
@Controller({ path: 'media', version: '1' })
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post()
  @RateLimit({ name: 'upload', limit: 300, windowSec: 3600, by: 'user' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' }, purpose: { type: 'string', enum: [...MEDIA_PURPOSES] } } } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 16 * 1024 * 1024, files: 1, fields: 5 } }))
  upload(@CurrentUser() user: AuthUser, @UploadedFile() file: { buffer: Buffer; originalname: string; size: number }, @Query('purpose') purposeQ?: string) {
    const purpose = z.enum(MEDIA_PURPOSES).default('listing').parse(purposeQ ?? (file as unknown as { purpose?: string })?.purpose ?? undefined);
    return this.media.upload(user.id, purpose, file);
  }

  @Public()
  @Get('private')
  async private(@Query('key') key: string, @Query('exp') exp: string, @Query('sig') sig: string, @Res() res: Response) {
    const buf = await this.media.readPrivate(String(key), Number(exp), String(sig));
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(buf);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.media.get(user.id, uuidParam.parse(id));
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.media.remove(user.id, uuidParam.parse(id));
  }
}
