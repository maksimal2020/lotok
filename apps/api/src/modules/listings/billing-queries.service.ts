import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, gt, inArray } from 'drizzle-orm';
import { DB, type Db } from '../../database/database.module';
import { userSubscriptions } from '../../database/schema';

/** Проверки оплаченных возможностей, нужные модулям без зависимости от биллинга. */
@Injectable()
export class BillingQueries {
  constructor(@Inject(DB) private readonly db: Db) {}

  async hasExtendedStats(userId: string) {
    const [r] = await this.db
      .select({ n: count() })
      .from(userSubscriptions)
      .where(and(eq(userSubscriptions.userId, userId), inArray(userSubscriptions.serviceType, ['analytics', 'pro_subscription']), gt(userSubscriptions.endsAt, new Date())));
    return r.n > 0;
  }
}
