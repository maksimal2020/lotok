import { Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { email, organizationSchema } from '@lotok/shared';
import { z } from 'zod';
import { CurrentUser, Public, type AuthUser } from '../../common/auth.decorators';
import { uuidParam, ZBody } from '../../common/zod';
import { OrganizationsService } from './organizations.service';

@ApiTags('organizations')
@ApiBearerAuth()
@Controller({ path: 'organizations', version: '1' })
export class OrganizationsController {
  constructor(private readonly orgs: OrganizationsService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @ZBody(organizationSchema) body: z.infer<typeof organizationSchema>) {
    return this.orgs.create(user.id, body);
  }

  @Public()
  @Get(':id')
  get(@Param('id') id: string) {
    return this.orgs.get(uuidParam.parse(id));
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @ZBody(organizationSchema.partial()) body: Partial<z.infer<typeof organizationSchema>>) {
    return this.orgs.update(user.id, uuidParam.parse(id), body);
  }

  @Get(':id/members')
  members(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orgs.members(user.id, uuidParam.parse(id));
  }

  @Post(':id/members')
  add(@CurrentUser() user: AuthUser, @Param('id') id: string, @ZBody(z.object({ email })) body: { email: string }) {
    return this.orgs.addMember(user.id, uuidParam.parse(id), body.email);
  }

  @Delete(':id/members/:userId')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('userId') memberId: string) {
    await this.orgs.removeMember(user.id, uuidParam.parse(id), uuidParam.parse(memberId));
  }
}
