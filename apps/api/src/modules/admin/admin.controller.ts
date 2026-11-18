import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  adPlacementSchema,
  assignRolesSchema,
  attributeSchema,
  blockUserSchema,
  categoryAttributeSchema,
  categorySchema,
  LISTING_STATUSES,
  moderationDecisionSchema,
  ORDER_STATUSES,
  paginationQuery,
  paidServiceSchema,
  refundSchema,
  regionSchema,
  resolveComplaintSchema,
  ROLES,
  stopWordSchema,
} from '@lotok/shared';
import { z } from 'zod';
import { Client, CurrentUser, RequirePermissions, type AuthUser, type ClientInfo } from '../../common/auth.decorators';
import { Errors } from '../../common/errors';
import { intParam, uuidParam, ZBody, ZQuery } from '../../common/zod';
import { AuditService, DEFAULT_SETTINGS, SettingsService, type AuditContext, type SettingKey } from '../../infra/platform.services';
import { CategoriesService } from '../catalog/categories.service';
import { RegionsService } from '../catalog/regions.service';
import { BillingService } from '../billing/billing.service';
import { AdsService } from '../billing/ads.service';
import { CommunityService } from '../community/community.service';
import { OrdersService } from '../orders/orders.service';
import { LedgerService } from '../payments/ledger.service';
import { PaymentsService } from '../payments/payments.service';
import { SearchService } from '../search/search.service';
import { AdminService } from './admin.service';

const ctxOf = (u: AuthUser, c: ClientInfo): AuditContext => ({ actorId: u.id, ip: c.ip, userAgent: c.userAgent });

const usersQuery = paginationQuery.extend({ q: z.string().max(100).optional(), status: z.enum(['active', 'blocked', 'deleted']).optional(), role: z.enum(ROLES).optional() });
const listingsQuery = paginationQuery.extend({
  status: z.enum(LISTING_STATUSES).optional(),
  q: z.string().max(100).optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  userId: z.uuid().optional(),
});
const statusQuery = paginationQuery.extend({ status: z.string().max(30).optional() });

/**
 * Административный API. Доступ проверяется на backend по правам роли (PermissionsGuard),
 * критичные действия пишутся в audit_logs.
 */
@ApiTags('admin')
@ApiBearerAuth()
@RequirePermissions('dashboard.read')
@Controller({ path: 'admin', version: '1' })
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly audit: AuditService,
    private readonly categories: CategoriesService,
    private readonly regions: RegionsService,
    private readonly billing: BillingService,
    private readonly ads: AdsService,
    private readonly community: CommunityService,
    private readonly orders: OrdersService,
    private readonly payments: PaymentsService,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
    private readonly search: SearchService,
  ) {}

  @Get('dashboard')
  dashboard() {
    return this.admin.dashboard();
  }

  @Get('analytics')
  @RequirePermissions('analytics.read')
  analytics(@Query('days') days?: string) {
    return this.admin.analytics(z.coerce.number().int().min(7).max(365).default(30).parse(days ?? undefined));
  }

  /* ---------- пользователи ---------- */

  @Get('users')
  @RequirePermissions('users.read')
  users(@ZQuery(usersQuery) q: z.infer<typeof usersQuery>) {
    return this.admin.listUsers(q);
  }

  @Get('users/:id')
  @RequirePermissions('users.read')
  user(@Param('id') id: string) {
    return this.admin.userDetail(uuidParam.parse(id));
  }

  @Post('users/:id/block')
  @HttpCode(204)
  @RequirePermissions('users.block')
  async block(@CurrentUser() u: AuthUser, @Client() c: ClientInfo, @Param('id') id: string, @ZBody(blockUserSchema) body: z.infer<typeof blockUserSchema>) {
    await this.admin.blockUser(ctxOf(u, c), uuidParam.parse(id), body.reason, body.until);
  }

  @Post('users/:id/unblock')
  @HttpCode(204)
  @RequirePermissions('users.block')
  async unblock(@CurrentUser() u: AuthUser, @Client() c: ClientInfo, @Param('id') id: string) {
    await this.admin.unblockUser(ctxOf(u, c), uuidParam.parse(id));
  }

  @Put('users/:id/roles')
  @RequirePermissions('roles.manage')
  roles(@CurrentUser() u: AuthUser, @Client() c: ClientInfo, @Param('id') id: string, @ZBody(assignRolesSchema) body: z.infer<typeof assignRolesSchema>) {
    return this.admin.setRoles(ctxOf(u, c), u.roles, uuidParam.parse(id), body.roles);
  }

  @Post('users/:id/bonus')
  @RequirePermissions('payments.refund')
  async bonus(@CurrentUser() u: AuthUser, @Client() c: ClientInfo, @Param('id') id: string, @Body() body: unknown) {
    const b = z.object({ amount: z.number().int().positive().max(10_000_000), reason: z.string().trim().min(3).max(200), key: z.string().min(8).max(80) }).parse(body);
    const posted = await this.ledger.issueBonus(uuidParam.parse(id), b.amount, b.reason, `admin-bonus:${b.key}`);
    if (posted) await this.audit.log(ctxOf(u, c), 'bonus.issue', 'user', id, null, { amount: b.amount, reason: b.reason });
    return { posted };
  }

  /* ---------- компании ---------- */

  @Get('organizations')
  @RequirePermissions('organizations.read')
  organizations(@ZQuery(paginationQuery.extend({ q: z.string().max(100).optional() })) q: { q?: string; page: number; limit: number }) {
    return this.admin.listOrganizations(q.q, q.page, q.limit);
  }

  @Post('organizations/:id/verify')
  @RequirePermissions('organizations.manage')
  verifyOrg(@CurrentUser() u: AuthUser, @Client() c: ClientInfo, @Param('id') id: string, @Body() body: { verified?: boolean }) {
    return this.admin.verifyOrganization(ctxOf(u, c), uuidParam.parse(id), body?.verified !== false);
  }

  @Post('organizations/:id/status')
  @HttpCode(204)
  @RequirePermissions('organizations.manage')
  async orgStatus(@CurrentUser() u: AuthUser, @Client() c: ClientInfo, @Param('id') id: string, @Body() body: unknown) {
    await this.admin.setOrganizationStatus(ctxOf(u, c), uuidParam.parse(id), z.object({ status: z.enum(['active', 'blocked']) }).parse(body).status);
  }

  /* ---------- объявления и модерация ---------- */

  @Get('listings')
  @RequirePermissions('listings.read')
  listings(@ZQuery(listingsQuery) q: z.infer<typeof listingsQuery>) {
    return this.admin.listListings(q);
  }

  @Get('moderation/queue')
  @RequirePermissions('listings.moderate')
  queue(@ZQuery(paginationQuery) q: z.infer<typeof paginationQuery>) {
    return this.admin.listListings({ ...q, status: 'moderation' });
  }

  @Get('listings/:id')
  @RequirePermissions('listings.read')
  listing(@Param('id') id: string) {
    return this.admin.listingDetail(uuidParam.parse(id));
  }

  @Post('listings/:id/moderate')
  @HttpCode(204)
  @RequirePermissions('listings.moderate')
  async moderate(@CurrentUser() u: AuthUser, @Client() c: ClientInfo, @Param('id') id: string, @ZBody(moderationDecisionSchema) body: z.infer<typeof moderationDecisionSchema>) {
    if (body.decision === 'block' && !u.permissions.has('listings.block')) throw Errors.forbidden();
    await this.admin.moderate(ctxOf(u, c), uuidParam.parse(id), body.decision, body.reason);
  }

  @Post('listings/:id/unblock')
  @HttpCode(204)
  @RequirePermissions('listings.block')
  async unblockListing(@CurrentUser() u: AuthUser, @Client() c: ClientInfo, @Param('id') id: string) {
    await this.admin.unblockListing(ctxOf(u, c), uuidParam.parse(id));
  }

  @Get('stop-words')
  @RequirePermissions('moderation.rules')
  stopWords() {
    return this.admin.stopWords();
  }

  @Post('stop-words')
  @RequirePermissions('moderation.rules')
  addStopWord(@CurrentUser() u: AuthUser, @Client() c: ClientInfo, @ZBody(stopWordSchema) body: z.infer<typeof stopWordSchema>) {
    return this.admin.addStopWord(ctxOf(u, c), body.word, body.action);
  }

  @Delete('stop-words/:id')
  @HttpCode(204)
  @RequirePermissions('moderation.rules')
  async removeStopWord(@CurrentUser() u: AuthUser, @Client() c: ClientInfo, @Param('id') id: string) {
    await this.admin.removeStopWord(ctxOf(u, c), intParam.parse(id));
  }

  /* ---------- жалобы и отзывы ---------- */

  @Get('complaints')
  @RequirePermissions('complaints.read')
  complaints(@ZQuery(statusQuery) q: z.infer<typeof statusQuery>) {
    return this.admin.listComplaints(q.status, q.page, q.limit);
  }

  @Get('complaints/:id')
  @RequirePermissions('complaints.read')
  complaint(@Param('id') id: string) {
    return this.admin.complaintTarget(uuidParam.parse(id));
  }

  @Post('complaints/:id/resolve')
  @HttpCode(204)
  @RequirePermissions('complaints.handle')
  async resolve(@CurrentUser() u: AuthUser, @Client() c: ClientInfo, @Param('id') id: string, @ZBody(resolveComplaintSchema) body: z.infer<typeof resolveComplaintSchema>) {
    await this.admin.resolveComplaint(ctxOf(u, c), uuidParam.parse(id), body);
  }

  @Post('reviews/:id/status')
  @RequirePermissions('reviews.moderate')
  async reviewStatus(@CurrentUser() u: AuthUser, @Client() c: ClientInfo, @Param('id') id: string, @Body() body: unknown) {
    const { status } = z.object({ status: z.enum(['published', 'hidden']) }).parse(body);
    const r = await this.community.setReviewStatus(uuidParam.parse(id), status);
    await this.audit.log(ctxOf(u, c), 'review.status', 'review', id, null, { status });
    return r;
  }

  /* ---------- категории и характеристики ---------- */

  @Get('categories')
  @RequirePermissions('categories.manage')
  categoriesTree() {
    return this.categories.tree(true);
  }

  @Post('categories')
  @RequirePermissions('categories.manage')
  async createCategory(@CurrentUser() u: AuthUser, @Client() c: ClientInfo, @ZBody(categorySchema) body: z.infer<typeof categorySchema>) {
    const r = await this.categories.create(body);
    await this.audit.log(ctxOf(u, c), 'category.create', 'category', r.id, null, r);
    return r;
  }

  @Patch('categories/:id')
  @RequirePermissions('categories.manage')
  async updateCategory(@CurrentUser() u: AuthUser, @Client() c: ClientInfo, @Param('id') id: string, @ZBody(categorySchema.partial()) body: Partial<z.infer<typeof categorySchema>>) {
    const r = await this.categories.update(intParam.parse(id), body);
    await this.audit.log(ctxOf(u, c), 'category.update', 'category', id, r.before, r.after);
    return r.after;
  }

  @Delete('categories/:id')
  @HttpCode(204)
  @RequirePermissions('categories.manage')
  async deleteCategory(@CurrentUser() u: AuthUser, @Client() c: ClientInfo, @Param('id') id: string) {
    const before = await this.categories.remove(intParam.parse(id));
    await this.audit.log(ctxOf(u, c), 'category.delete', 'category', id, before, null);
  }

  @Get('attributes')
  @RequirePermissions('categories.manage')
  attributes() {
    return this.categories.listAttributes();
  }

  @Post('attributes')
  @RequirePermissions('categories.manage')
  async createAttribute(@CurrentUser() u: AuthUser, @Client() c: ClientInfo, @ZBody(attributeSchema) body: z.infer<typeof attributeSchema>) {
    const r = await this.categories.upsertAttribute(body);
    await this.audit.log(ctxOf(u, c), 'attribute.create', 'attribute', r.id, null, body);
    return r;
  }

  @Patch('attributes/:id')
  @RequirePermissions('categories.manage')
  async updateAttribute(@CurrentUser() u: AuthUser, @Client() c: ClientInfo, @Param('id') id: string, @ZBody(attributeSchema) body: z.infer<typeof attributeSchema>) {
    const r = await this.categories.upsertAttribute(body, intParam.parse(id));
    await this.audit.log(ctxOf(u, c), 'attribute.update', 'attribute', id, null, body);
    return r;
  }

  @Get('categories/:id/attributes')
  @RequirePermissions('categories.manage')
  categoryAttributes(@Param('id') id: string) {
    return this.categories.attributesFor(intParam.parse(id));
  }

  @Put('categories/:id/attributes')
  @HttpCode(204)
  @RequirePermissions('categories.manage')
  async link(@CurrentUser() u: AuthUser, @Client() c: ClientInfo, @Param('id') id: string, @ZBody(categoryAttributeSchema) body: z.infer<typeof categoryAttributeSchema>) {
    await this.categories.linkAttribute(intParam.parse(id), body);
    await this.audit.log(ctxOf(u, c), 'category.attribute.link', 'category', id, null, body);
  }

  @Delete('categories/:id/attributes/:attributeId')
  @HttpCode(204)
  @RequirePermissions('categories.manage')
  async unlink(@CurrentUser() u: AuthUser, @Client() c: ClientInfo, @Param('id') id: string, @Param('attributeId') attributeId: string) {
    await this.categories.unlinkAttribute(intParam.parse(id), intParam.parse(attributeId));
    await this.audit.log(ctxOf(u, c), 'category.attribute.unlink', 'category', id, { attributeId }, null);
  }

  /* ---------- регионы ---------- */

  @Get('regions')
  @RequirePermissions('regions.manage')
  allRegions() {
    return this.regions.all();
  }

  @Post('regions')
  @RequirePermissions('regions.manage')
  async createRegion(@CurrentUser() u: AuthUser, @Client() c: ClientInfo, @ZBody(regionSchema) body: z.infer<typeof regionSchema>) {
    const r = await this.regions.create({ ...body, parentId: body.parentId ?? null, lat: body.lat ?? null, lng: body.lng ?? null });
    await this.audit.log(ctxOf(u, c), 'region.create', 'region', r.id, null, r);
    return r;
  }

  @Patch('regions/:id')
  @RequirePermissions('regions.manage')
  async updateRegion(@CurrentUser() u: AuthUser, @Client() c: ClientInfo, @Param('id') id: string, @ZBody(regionSchema.partial()) body: Partial<z.infer<typeof regionSchema>>) {
    const r = await this.regions.update(intParam.parse(id), body);
    await this.audit.log(ctxOf(u, c), 'region.update', 'region', id, r.before, r.after);
    return r.after;
  }

  /* ---------- тарифы и платные услуги ---------- */

  @Get('services')
  @RequirePermissions('tariffs.manage')
  services() {
    return this.billing.adminList();
  }

  @Post('services')
  @RequirePermissions('tariffs.manage')
  async createService(@CurrentUser() u: AuthUser, @Client() c: ClientInfo, @ZBody(paidServiceSchema) body: z.infer<typeof paidServiceSchema>) {
    const r = await this.billing.upsertService(body);
    await this.audit.log(ctxOf(u, c), 'service.create', 'paid_service', r.after.id, null, r.after);
    return r.after;
  }

  @Patch('services/:id')
  @RequirePermissions('tariffs.manage')
  async updateService(@CurrentUser() u: AuthUser, @Client() c: ClientInfo, @Param('id') id: string, @ZBody(paidServiceSchema) body: z.infer<typeof paidServiceSchema>) {
    const r = await this.billing.upsertService(body, intParam.parse(id));
    await this.audit.log(ctxOf(u, c), 'service.update', 'paid_service', id, r.before, r.after);
    return r.after;
  }

  /* ---------- реклама ---------- */

  @Get('ads')
  @RequirePermissions('ads.manage')
  adsList() {
    return this.ads.list();
  }

  @Post('ads')
  @RequirePermissions('ads.manage')
  async createAd(@CurrentUser() u: AuthUser, @Client() c: ClientInfo, @ZBody(adPlacementSchema) body: z.infer<typeof adPlacementSchema>) {
    const r = await this.ads.upsert(body);
    await this.audit.log(ctxOf(u, c), 'ad.create', 'ad', r.after.id, null, r.after);
    return r.after;
  }

  @Patch('ads/:id')
  @RequirePermissions('ads.manage')
  async updateAd(@CurrentUser() u: AuthUser, @Client() c: ClientInfo, @Param('id') id: string, @ZBody(adPlacementSchema) body: z.infer<typeof adPlacementSchema>) {
    const r = await this.ads.upsert(body, uuidParam.parse(id));
    await this.audit.log(ctxOf(u, c), 'ad.update', 'ad', id, r.before, r.after);
    return r.after;
  }

  /* ---------- платежи и заказы ---------- */

  @Get('payments')
  @RequirePermissions('payments.read')
  paymentsList(@ZQuery(statusQuery) q: z.infer<typeof statusQuery>) {
    return this.admin.listPayments(q.status, q.page, q.limit);
  }

  @Post('payments/:id/refund')
  @RequirePermissions('payments.refund')
  async refund(@CurrentUser() u: AuthUser, @Client() c: ClientInfo, @Param('id') id: string, @ZBody(refundSchema) body: z.infer<typeof refundSchema>) {
    const r = await this.payments.refund(uuidParam.parse(id), body.amount, body.reason, u.id, `admin:${id}:${body.amount ?? 'full'}:${Date.now()}`.slice(0, 80));
    await this.audit.log(ctxOf(u, c), 'payment.refund', 'payment', id, null, { amount: r.amount, reason: body.reason, refundId: r.id });
    return r;
  }

  @Get('ledger/trial-balance')
  @RequirePermissions('payments.read')
  trialBalance() {
    return this.ledger.trialBalance();
  }

  @Get('orders')
  @RequirePermissions('orders.read')
  ordersList(@ZQuery(paginationQuery.extend({ status: z.enum(ORDER_STATUSES).optional() })) q: { page: number; limit: number; status?: (typeof ORDER_STATUSES)[number] }) {
    return this.orders.listAll(q.page, q.limit, q.status);
  }

  @Get('orders/:id')
  @RequirePermissions('orders.read')
  order(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.orders.get(u.id, uuidParam.parse(id), true);
  }

  @Post('orders/:id/:action')
  @RequirePermissions('orders.manage')
  async orderAction(@CurrentUser() u: AuthUser, @Client() c: ClientInfo, @Param('id') id: string, @Param('action') action: string, @Body() body: unknown) {
    const a = z.enum(['cancel', 'deliver', 'complete', 'approve_refund', 'reject_refund']).parse(action);
    const b = z.object({ reason: z.string().max(500).optional() }).parse(body ?? {});
    const r = await this.orders.action(u.id, uuidParam.parse(id), a, b, true);
    await this.audit.log(ctxOf(u, c), `order.${a}`, 'order', id, null, { reason: b.reason ?? null, status: r.status });
    return r;
  }

  /* ---------- журнал, безопасность, настройки ---------- */

  @Get('audit')
  @RequirePermissions('audit.read')
  auditLog(@ZQuery(paginationQuery.extend({ actorId: z.uuid().optional(), entityType: z.string().max(40).optional(), entityId: z.string().max(64).optional() })) q: { page: number; limit: number; actorId?: string; entityType?: string; entityId?: string }) {
    return this.admin.auditLog(q);
  }

  @Get('security-events')
  @RequirePermissions('audit.read')
  security(@ZQuery(paginationQuery.extend({ type: z.string().max(60).optional() })) q: { page: number; limit: number; type?: string }) {
    return this.admin.securityEvents(q.type, q.page, q.limit);
  }

  @Get('settings')
  @RequirePermissions('settings.manage')
  allSettings() {
    return this.settings.all();
  }

  @Put('settings/:key')
  @RequirePermissions('settings.manage')
  async setSetting(@CurrentUser() u: AuthUser, @Client() c: ClientInfo, @Param('key') key: string, @Body() body: unknown) {
    if (!(key in DEFAULT_SETTINGS)) throw Errors.notFound('Настройка');
    const def = DEFAULT_SETTINGS[key as SettingKey];
    const value = (body as { value?: unknown })?.value;
    const ok = def === null ? value === null || typeof value === 'number' : typeof value === typeof def;
    if (!ok) throw Errors.badRequest('invalid_setting', 'Неверный тип значения');
    const before = await this.settings.get(key as SettingKey);
    await this.settings.set(key as SettingKey, value, u.id);
    await this.audit.log(ctxOf(u, c), 'settings.update', 'setting', key, { value: before }, { value });
    return { key, value };
  }

  @Post('search/reindex')
  @RequirePermissions('settings.manage')
  async reindex(@CurrentUser() u: AuthUser, @Client() c: ClientInfo) {
    const n = await this.search.reindexAll();
    await this.audit.log(ctxOf(u, c), 'search.reindex', 'search', null, null, { indexed: n });
    return { indexed: n, engine: this.search.engine.name };
  }

  @Get('system')
  @RequirePermissions('settings.manage')
  system() {
    return this.admin.system();
  }
}
