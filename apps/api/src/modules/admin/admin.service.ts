import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, gte, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { canAssignRole, type Role } from '@lotok/shared';
import { DB, type Db } from '../../database/database.module';
import {
  auditLogs,
  complaints,
  listings,
  messages,
  moderationDecisions,
  orders,
  organizations,
  payments,
  reviews,
  securityEvents,
  sessions,
  stopWords,
  userRoles,
  users,
} from '../../database/schema';
import { AuditService, type AuditContext } from '../../infra/platform.services';
import { JobsService } from '../../infra/jobs.service';
import { Errors } from '../../common/errors';
import { escapeLike, paginate } from '../../common/util';
import { AuthStateService } from '../auth/auth-state.service';
import { ListingPresenter } from '../listings/listing.presenter';
import { ListingsService } from '../listings/listings.service';
import { AutoModerationService } from '../listings/auto-moderation.service';
import { CommunityService } from '../community/community.service';
import { NotificationsService } from '../notifications/notifications.service';
import { presentPayment } from '../payments/payments.service';

@Injectable()
export class AdminService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly authState: AuthStateService,
    private readonly listings: ListingsService,
    private readonly presenter: ListingPresenter,
    private readonly autoMod: AutoModerationService,
    private readonly community: CommunityService,
    private readonly notifications: NotificationsService,
    private readonly jobs: JobsService,
  ) {}

  /* ------------------------------ dashboard / analytics ------------------------------ */

  async dashboard() {
    const since = new Date(Date.now() - 86_400_000);
    const month = new Date(Date.now() - 30 * 86_400_000);
    const [[u], [uNew], [lActive], [lModeration], [cOpen], [oDay], revenue, [pDay]] = await Promise.all([
      this.db.select({ n: count() }).from(users).where(eq(users.status, 'active')),
      this.db.select({ n: count() }).from(users).where(gte(users.createdAt, since)),
      this.db.select({ n: count() }).from(listings).where(eq(listings.status, 'active')),
      this.db.select({ n: count() }).from(listings).where(eq(listings.status, 'moderation')),
      this.db.select({ n: count() }).from(complaints).where(inArray(complaints.status, ['new', 'in_review'])),
      this.db.select({ n: count() }).from(orders).where(gte(orders.createdAt, since)),
      this.db.execute<{ revenue: string | null }>(sql`
        SELECT -sum(e.amount) AS revenue FROM ledger_entries e
        JOIN ledger_accounts a ON a.id = e.account_id
        WHERE a.type = 'platform_revenue' AND e.created_at >= ${month.toISOString()}`),
      this.db.select({ n: count(), sum: sql<string>`coalesce(sum(${payments.amount}), 0)` }).from(payments).where(and(eq(payments.status, 'succeeded'), gte(payments.paidAt, since))),
    ]);
    return {
      users: { active: u.n, new24h: uNew.n },
      listings: { active: lActive.n, moderationQueue: lModeration.n },
      complaints: { open: cOpen.n },
      orders: { last24h: oDay.n },
      payments: { succeeded24h: pDay.n, amount24h: Number(pDay.sum) },
      revenue30d: Number(revenue.rows[0]?.revenue ?? 0),
    };
  }

  async analytics(days: number) {
    const series = await this.db.execute<{ day: string; users: string; listings: string; orders: string; revenue: string }>(sql`
      WITH d AS (SELECT generate_series(current_date - ${days - 1}::int, current_date, interval '1 day')::date AS day)
      SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
        (SELECT count(*) FROM users WHERE created_at::date = d.day) AS users,
        (SELECT count(*) FROM listing_status_history WHERE to_status = 'active' AND from_status = 'moderation' AND created_at::date = d.day) AS listings,
        (SELECT count(*) FROM orders WHERE created_at::date = d.day) AS orders,
        (SELECT coalesce(-sum(e.amount), 0) FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id
           WHERE a.type = 'platform_revenue' AND e.created_at::date = d.day) AS revenue
      FROM d ORDER BY d.day`);
    const byCategory = await this.db.execute<{ name: string; n: string }>(sql`
      SELECT c.name, count(*) AS n FROM listings l JOIN categories c ON c.id = l.category_id
      WHERE l.status = 'active' GROUP BY c.name ORDER BY n DESC LIMIT 15`);
    return {
      daily: series.rows.map((r) => ({ day: r.day, users: Number(r.users), listings: Number(r.listings), orders: Number(r.orders), revenue: Number(r.revenue) })),
      topCategories: byCategory.rows.map((r) => ({ name: r.name, count: Number(r.n) })),
    };
  }

  /* ------------------------------ пользователи ------------------------------ */

  async listUsers(q: { q?: string; status?: string; role?: Role; page: number; limit: number }) {
    const conds: SQL[] = [];
    if (q.q) {
      const like = `%${escapeLike(q.q)}%`;
      conds.push(or(ilike(users.email, like), ilike(users.displayName, like), ilike(users.phone, like), sql`${users.id}::text = ${q.q}`)!);
    }
    if (q.status) conds.push(eq(users.status, q.status as 'active'));
    if (q.role) conds.push(sql`EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = ${users.id} AND r.role = ${q.role})`);
    const where = conds.length ? and(...conds) : undefined;
    const { offset } = paginate(q.page, q.limit);
    const [rows, [{ total }]] = await Promise.all([
      this.db.select().from(users).where(where).orderBy(desc(users.createdAt)).limit(q.limit).offset(offset),
      this.db.select({ total: count() }).from(users).where(where),
    ]);
    const roles = rows.length ? await this.db.select().from(userRoles).where(inArray(userRoles.userId, rows.map((r) => r.id))) : [];
    return {
      items: rows.map((u) => ({
        id: u.id,
        email: u.email,
        phone: u.phone,
        displayName: u.displayName,
        status: u.status,
        blockedReason: u.blockedReason,
        emailVerified: !!u.emailVerifiedAt,
        phoneVerified: !!u.phoneVerifiedAt,
        ratingAvg: u.ratingAvg,
        createdAt: u.createdAt.toISOString(),
        lastSeenAt: u.lastSeenAt?.toISOString() ?? null,
        roles: roles.filter((r) => r.userId === u.id).map((r) => r.role),
      })),
      total,
      page: q.page,
      limit: q.limit,
    };
  }

  async userDetail(id: string) {
    const [u] = await this.db.select().from(users).where(eq(users.id, id));
    if (!u) throw Errors.notFound('Пользователь');
    const [roles, listingCounts, orderCount, activeSessions, events, complaintsAgainst] = await Promise.all([
      this.db.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, id)),
      this.db.select({ status: listings.status, n: count() }).from(listings).where(eq(listings.userId, id)).groupBy(listings.status),
      this.db.select({ n: count() }).from(orders).where(or(eq(orders.buyerId, id), eq(orders.sellerId, id))),
      this.db.select({ n: count() }).from(sessions).where(and(eq(sessions.userId, id), isNull(sessions.revokedAt))),
      this.db.select().from(securityEvents).where(eq(securityEvents.userId, id)).orderBy(desc(securityEvents.createdAt)).limit(30),
      this.db.select({ n: count() }).from(complaints).where(and(eq(complaints.targetType, 'user'), eq(complaints.targetId, id))),
    ]);
    const { passwordHash: _p, ...safe } = u;
    return {
      ...safe,
      roles: roles.map((r) => r.role),
      listings: Object.fromEntries(listingCounts.map((c) => [c.status, c.n])),
      orders: orderCount[0].n,
      activeSessions: activeSessions[0].n,
      complaintsAgainst: complaintsAgainst[0].n,
      securityEvents: events,
    };
  }

  async blockUser(ctx: AuditContext, id: string, reason: string, until?: string) {
    const [before] = await this.db.select({ status: users.status, roles: sql`1` }).from(users).where(eq(users.id, id));
    if (!before) throw Errors.notFound('Пользователь');
    if (id === ctx.actorId) throw Errors.badRequest('self_block', 'Нельзя заблокировать себя');
    const staff = await this.db.select().from(userRoles).where(eq(userRoles.userId, id));
    if (staff.some((s) => s.role === 'super_admin')) throw Errors.forbidden('Нельзя заблокировать суперадминистратора');
    await this.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ status: 'blocked', blockedReason: reason, blockedUntil: until ? new Date(until) : null, tokenVersion: sql`${users.tokenVersion} + 1`, updatedAt: new Date() })
        .where(eq(users.id, id));
      await tx.update(sessions).set({ revokedAt: new Date(), revokedReason: 'blocked' }).where(and(eq(sessions.userId, id), isNull(sessions.revokedAt)));
      await this.audit.log(ctx, 'user.block', 'user', id, { status: before.status }, { status: 'blocked', reason, until: until ?? null }, tx);
    });
    await this.authState.invalidate(id);
    // Активные объявления заблокированного пользователя снимаются из выдачи.
    const active = await this.db.select({ id: listings.id }).from(listings).where(and(eq(listings.userId, id), eq(listings.status, 'active')));
    for (const l of active) await this.listings.transition(l.id, 'blocked', 'moderator', { actorId: ctx.actorId, reason: `Пользователь заблокирован: ${reason}` });
  }

  async unblockUser(ctx: AuditContext, id: string) {
    const [u] = await this.db.update(users).set({ status: 'active', blockedReason: null, blockedUntil: null, updatedAt: new Date() }).where(and(eq(users.id, id), eq(users.status, 'blocked'))).returning();
    if (!u) throw Errors.conflict('not_blocked', 'Пользователь не заблокирован');
    await this.audit.log(ctx, 'user.unblock', 'user', id, { status: 'blocked' }, { status: 'active' });
    await this.authState.invalidate(id);
  }

  async setRoles(ctx: AuditContext, actorRoles: Role[], id: string, next: Role[]) {
    const current = (await this.db.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, id))).map((r) => r.role);
    const changed = [...next.filter((r) => !current.includes(r)), ...current.filter((r) => !next.includes(r))];
    for (const r of changed) if (!canAssignRole(actorRoles, r)) throw Errors.forbidden(`Недостаточно прав для изменения роли ${r}`);
    if (id === ctx.actorId && current.includes('super_admin') && !next.includes('super_admin')) throw Errors.badRequest('self_demote', 'Нельзя снять с себя роль суперадминистратора');
    await this.db.transaction(async (tx) => {
      await tx.delete(userRoles).where(eq(userRoles.userId, id));
      if (next.length) await tx.insert(userRoles).values(next.map((role) => ({ userId: id, role, grantedBy: ctx.actorId })));
      await this.audit.log(ctx, 'user.roles', 'user', id, { roles: current }, { roles: next }, tx);
    });
    await this.authState.invalidate(id);
    return next;
  }

  /* ------------------------------ организации ------------------------------ */

  async listOrganizations(q: string | undefined, page: number, limit: number) {
    const where = q ? or(ilike(organizations.name, `%${escapeLike(q)}%`), eq(organizations.inn, q)) : undefined;
    const { offset } = paginate(page, limit);
    const [items, [{ total }]] = await Promise.all([
      this.db.select().from(organizations).where(where).orderBy(desc(organizations.createdAt)).limit(limit).offset(offset),
      this.db.select({ total: count() }).from(organizations).where(where),
    ]);
    return { items, total, page, limit };
  }

  async verifyOrganization(ctx: AuditContext, id: string, verified: boolean) {
    const [o] = await this.db.update(organizations).set({ verifiedAt: verified ? new Date() : null, updatedAt: new Date() }).where(eq(organizations.id, id)).returning();
    if (!o) throw Errors.notFound('Компания');
    await this.audit.log(ctx, verified ? 'organization.verify' : 'organization.unverify', 'organization', id, null, { verified });
    return o;
  }

  async setOrganizationStatus(ctx: AuditContext, id: string, status: 'active' | 'blocked') {
    const [before] = await this.db.select().from(organizations).where(eq(organizations.id, id));
    if (!before) throw Errors.notFound('Компания');
    await this.db.update(organizations).set({ status, updatedAt: new Date() }).where(eq(organizations.id, id));
    await this.audit.log(ctx, 'organization.status', 'organization', id, { status: before.status }, { status });
  }

  /* ------------------------------ объявления и модерация ------------------------------ */

  async listListings(q: { status?: string; q?: string; categoryId?: number; userId?: string; page: number; limit: number }) {
    const conds: SQL[] = [];
    if (q.status) conds.push(eq(listings.status, q.status as 'active'));
    if (q.categoryId) conds.push(eq(listings.categoryId, q.categoryId));
    if (q.userId) conds.push(eq(listings.userId, q.userId));
    if (q.q) conds.push(or(ilike(listings.title, `%${escapeLike(q.q)}%`), sql`${listings.id}::text = ${q.q}`)!);
    const where = conds.length ? and(...conds) : undefined;
    const { offset } = paginate(q.page, q.limit);
    const order = q.status === 'moderation' ? listings.updatedAt : desc(listings.updatedAt);
    const [rows, [{ total }]] = await Promise.all([
      this.db.select().from(listings).where(where).orderBy(order).limit(q.limit).offset(offset),
      this.db.select({ total: count() }).from(listings).where(where),
    ]);
    const cards = await this.presenter.cards(rows, null);
    return {
      items: cards.map((c, i) => ({ ...c, flags: rows[i].moderationFlags, description: rows[i].description.slice(0, 500), rejectionReason: rows[i].rejectionReason, updatedAt: rows[i].updatedAt.toISOString() })),
      total,
      page: q.page,
      limit: q.limit,
    };
  }

  async listingDetail(id: string) {
    const row = await this.listings.getRow(id);
    const [detail, decisions, history] = await Promise.all([
      this.presenter.detail(row, null),
      this.db.select().from(moderationDecisions).where(eq(moderationDecisions.listingId, id)).orderBy(desc(moderationDecisions.createdAt)),
      this.listings.history(row.userId, id),
    ]);
    return { ...detail, flags: row.moderationFlags, rejectionReason: row.rejectionReason, decisions, history };
  }

  async moderate(ctx: AuditContext, id: string, decision: 'approve' | 'reject' | 'block', reason?: string) {
    if ((decision === 'reject' || decision === 'block') && !reason) throw Errors.badRequest('reason_required', 'Укажите причину');
    const target = { approve: 'active', reject: 'rejected', block: 'blocked' } as const;
    const { from } = await this.listings.transition(id, target[decision], 'moderator', { actorId: ctx.actorId, reason });
    await this.db.insert(moderationDecisions).values({ listingId: id, moderatorId: ctx.actorId, automatic: false, decision, reason: reason ?? null });
    await this.audit.log(ctx, `listing.${decision}`, 'listing', id, { status: from }, { status: target[decision], reason: reason ?? null });
  }

  async unblockListing(ctx: AuditContext, id: string) {
    await this.listings.transition(id, 'inactive', 'moderator', { actorId: ctx.actorId, reason: 'unblocked' });
    await this.audit.log(ctx, 'listing.unblock', 'listing', id, { status: 'blocked' }, { status: 'inactive' });
  }

  async stopWords() {
    return this.db.select().from(stopWords).orderBy(stopWords.word);
  }

  async addStopWord(ctx: AuditContext, word: string, action: string) {
    const [r] = await this.db.insert(stopWords).values({ word: word.toLowerCase(), action }).onConflictDoUpdate({ target: stopWords.word, set: { action } }).returning();
    await this.autoMod.invalidateStopWords();
    await this.audit.log(ctx, 'moderation.stop_word.add', 'stop_word', r.id, null, { word, action });
    return r;
  }

  async removeStopWord(ctx: AuditContext, id: number) {
    const [r] = await this.db.delete(stopWords).where(eq(stopWords.id, id)).returning();
    if (!r) throw Errors.notFound('Стоп-слово');
    await this.autoMod.invalidateStopWords();
    await this.audit.log(ctx, 'moderation.stop_word.remove', 'stop_word', id, r, null);
  }

  /* ------------------------------ жалобы ------------------------------ */

  async listComplaints(status: string | undefined, page: number, limit: number) {
    const where = status ? eq(complaints.status, status as 'new') : undefined;
    const { offset } = paginate(page, limit);
    const [rows, [{ total }]] = await Promise.all([
      this.db
        .select({ c: complaints, reporter: { id: users.id, displayName: users.displayName } })
        .from(complaints)
        .innerJoin(users, eq(users.id, complaints.reporterId))
        .where(where)
        .orderBy(desc(complaints.createdAt))
        .limit(limit)
        .offset(offset),
      this.db.select({ total: count() }).from(complaints).where(where),
    ]);
    return { items: rows.map((r) => this.community.presentComplaint(r.c, r.reporter)), total, page, limit };
  }

  async complaintTarget(id: string) {
    const [c] = await this.db.select().from(complaints).where(eq(complaints.id, id));
    if (!c) throw Errors.notFound('Жалоба');
    let target: unknown = null;
    if (c.targetType === 'listing') target = await this.listingDetail(c.targetId).catch(() => null);
    if (c.targetType === 'user') target = await this.userDetail(c.targetId).catch(() => null);
    if (c.targetType === 'message') [target] = await this.db.select().from(messages).where(eq(messages.id, c.targetId));
    if (c.targetType === 'review') [target] = await this.db.select().from(reviews).where(eq(reviews.id, c.targetId));
    return { complaint: this.community.presentComplaint(c), target };
  }

  async resolveComplaint(ctx: AuditContext, id: string, input: { status: 'in_review' | 'resolved' | 'rejected'; resolution?: string; blockTarget: boolean }) {
    const [c] = await this.db.select().from(complaints).where(eq(complaints.id, id));
    if (!c) throw Errors.notFound('Жалоба');
    if (c.status === 'resolved' || c.status === 'rejected') throw Errors.conflict('complaint_closed', 'Жалоба уже закрыта');
    if (input.blockTarget && input.status === 'resolved') {
      const reason = input.resolution ?? 'Нарушение правил по жалобе пользователя';
      if (c.targetType === 'listing') {
        const l = await this.listings.getRow(c.targetId);
        if (['moderation', 'active', 'inactive', 'rejected'].includes(l.status)) await this.listings.transition(l.id, 'blocked', 'moderator', { actorId: ctx.actorId, reason });
      } else if (c.targetType === 'user') await this.blockUser(ctx, c.targetId, reason);
      else if (c.targetType === 'review') await this.community.setReviewStatus(c.targetId, 'hidden');
      else if (c.targetType === 'message') {
        const [m] = await this.db.select().from(messages).where(eq(messages.id, c.targetId));
        if (m) await this.db.update(messages).set({ body: '[Сообщение скрыто модератором]', attachmentMediaId: null }).where(eq(messages.id, m.id));
      }
    }
    await this.db
      .update(complaints)
      .set({ status: input.status, resolution: input.resolution ?? null, handledBy: ctx.actorId, handledAt: new Date() })
      .where(eq(complaints.id, id));
    // Закрытие всех открытых жалоб на ту же цель тем же решением.
    if (input.status === 'resolved' && input.blockTarget) {
      await this.db
        .update(complaints)
        .set({ status: 'resolved', resolution: input.resolution ?? null, handledBy: ctx.actorId, handledAt: new Date() })
        .where(and(eq(complaints.targetType, c.targetType), eq(complaints.targetId, c.targetId), inArray(complaints.status, ['new', 'in_review'])));
    }
    await this.audit.log(ctx, 'complaint.resolve', 'complaint', id, { status: c.status }, input);
    if (input.status !== 'in_review') {
      await this.notifications.notify(c.reporterId, {
        type: 'complaint.resolved',
        group: 'listings',
        title: 'Жалоба рассмотрена',
        body: input.status === 'resolved' ? 'Спасибо! Мы приняли меры по вашей жалобе.' : 'Мы проверили жалобу и не нашли нарушений.',
        data: { complaintId: id },
      });
    }
  }

  /* ------------------------------ платежи, журнал ------------------------------ */

  async listPayments(status: string | undefined, page: number, limit: number) {
    const where = status ? eq(payments.status, status as 'pending') : undefined;
    const { offset } = paginate(page, limit);
    const [rows, [{ total }]] = await Promise.all([
      this.db.select().from(payments).where(where).orderBy(desc(payments.createdAt)).limit(limit).offset(offset),
      this.db.select({ total: count() }).from(payments).where(where),
    ]);
    return { items: rows.map((p) => ({ ...presentPayment(p), userId: p.userId, providerPaymentId: p.providerPaymentId })), total, page, limit };
  }

  async auditLog(q: { actorId?: string; entityType?: string; entityId?: string; page: number; limit: number }) {
    const conds: SQL[] = [];
    if (q.actorId) conds.push(eq(auditLogs.actorId, q.actorId));
    if (q.entityType) conds.push(eq(auditLogs.entityType, q.entityType));
    if (q.entityId) conds.push(eq(auditLogs.entityId, q.entityId));
    const where = conds.length ? and(...conds) : undefined;
    const { offset } = paginate(q.page, q.limit);
    const [rows, [{ total }]] = await Promise.all([
      this.db
        .select({ a: auditLogs, actor: users.displayName })
        .from(auditLogs)
        .leftJoin(users, eq(users.id, auditLogs.actorId))
        .where(where)
        .orderBy(desc(auditLogs.createdAt))
        .limit(q.limit)
        .offset(offset),
      this.db.select({ total: count() }).from(auditLogs).where(where),
    ]);
    return { items: rows.map((r) => ({ ...r.a, actorName: r.actor })), total, page: q.page, limit: q.limit };
  }

  async securityEvents(type: string | undefined, page: number, limit: number) {
    const where = type ? eq(securityEvents.type, type) : undefined;
    const { offset } = paginate(page, limit);
    const [rows, [{ total }]] = await Promise.all([
      this.db.select().from(securityEvents).where(where).orderBy(desc(securityEvents.createdAt)).limit(limit).offset(offset),
      this.db.select({ total: count() }).from(securityEvents).where(where),
    ]);
    return { items: rows, total, page, limit };
  }

  async system() {
    return { queues: await this.jobs.stats() };
  }
}
