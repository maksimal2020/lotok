import { Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { createComplaintSchema, createReviewSchema, paginationQuery } from '@lotok/shared';
import { z } from 'zod';
import { CurrentUser, Public, RateLimit, type AuthUser } from '../../common/auth.decorators';
import { uuidParam, ZBody, ZQuery } from '../../common/zod';
import { CommunityService } from './community.service';

@ApiTags('community')
@ApiBearerAuth()
@Controller({ version: '1' })
export class CommunityController {
  constructor(private readonly svc: CommunityService) {}

  @Post('reviews')
  @RateLimit({ name: 'review', limit: 20, windowSec: 3600, by: 'user' })
  review(@CurrentUser() user: AuthUser, @ZBody(createReviewSchema) body: z.infer<typeof createReviewSchema>) {
    return this.svc.createReview(user.id, body);
  }

  @Public()
  @Get('users/:id/reviews')
  reviews(@Param('id') id: string, @ZQuery(paginationQuery) q: z.infer<typeof paginationQuery>) {
    return this.svc.userReviews(uuidParam.parse(id), q.page, q.limit);
  }

  @Post('complaints')
  @RateLimit({ name: 'complaint', limit: 30, windowSec: 3600, by: 'user' })
  complain(@CurrentUser() user: AuthUser, @ZBody(createComplaintSchema) body: z.infer<typeof createComplaintSchema>) {
    return this.svc.createComplaint(user.id, body);
  }

  @Get('complaints/mine')
  mine(@CurrentUser() user: AuthUser) {
    return this.svc.myComplaints(user.id);
  }
}
