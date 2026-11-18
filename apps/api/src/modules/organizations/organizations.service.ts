import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq } from 'drizzle-orm';
import type { OrganizationDto, OrganizationInput } from '@lotok/shared';
import { DB, type Db } from '../../database/database.module';
import { listings, media, organizationMembers, organizations, users } from '../../database/schema';
import { StorageService } from '../../infra/storage.service';
import { Errors } from '../../common/errors';
import { mediaUrls } from '../media/media.presenter';

type OrgRow = typeof organizations.$inferSelect;

/** Профили компаний: ИНН/ОГРН, участники (владелец и менеджеры), публичная страница. */
@Injectable()
export class OrganizationsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly storage: StorageService,
  ) {}

  private async present(o: OrgRow): Promise<OrganizationDto> {
    const [[{ n }], logo] = await Promise.all([
      this.db.select({ n: count() }).from(listings).where(and(eq(listings.organizationId, o.id), eq(listings.status, 'active'))),
      o.logoMediaId ? this.db.select().from(media).where(eq(media.id, o.logoMediaId)) : Promise.resolve([]),
    ]);
    return {
      id: o.id,
      name: o.name,
      inn: o.inn,
      ogrn: o.ogrn,
      legalAddress: o.legalAddress,
      description: o.description,
      website: o.website,
      logoUrl: mediaUrls(this.storage, logo[0])?.medium ?? null,
      cityId: o.cityId,
      verified: !!o.verifiedAt,
      status: o.status,
      createdAt: o.createdAt.toISOString(),
      activeListings: n,
      ratingAvg: o.ratingAvg,
      ratingCount: o.ratingCount,
    };
  }

  /** Контрольная сумма ИНН (алгоритм ФНС). */
  static validInn(inn: string): boolean {
    const d = inn.split('').map(Number);
    const check = (coef: number[]) => (coef.reduce((s, c, i) => s + c * d[i], 0) % 11) % 10;
    if (d.length === 10) return check([2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[9];
    if (d.length === 12) return check([7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[10] && check([3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[11];
    return false;
  }

  async create(ownerId: string, input: OrganizationInput) {
    if (!OrganizationsService.validInn(input.inn)) throw Errors.badRequest('invalid_inn', 'Некорректный ИНН');
    const id = await this.db.transaction(async (tx) => {
      const [o] = await tx
        .insert(organizations)
        .values({ ...input, ownerId, logoMediaId: input.logoMediaId ?? null })
        .returning({ id: organizations.id });
      await tx.insert(organizationMembers).values({ organizationId: o.id, userId: ownerId, role: 'owner' });
      return o.id;
    });
    return this.get(id);
  }

  async get(id: string) {
    const [o] = await this.db.select().from(organizations).where(eq(organizations.id, id));
    if (!o || o.status === 'deleted') throw Errors.notFound('Компания');
    return this.present(o);
  }

  private async assertRole(orgId: string, userId: string, roles: ('owner' | 'manager')[]) {
    const [m] = await this.db
      .select()
      .from(organizationMembers)
      .where(and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.userId, userId)));
    if (!m) throw Errors.notFound('Компания');
    if (!roles.includes(m.role)) throw Errors.forbidden('Действие доступно только владельцу компании');
  }

  async update(userId: string, id: string, input: Partial<OrganizationInput>) {
    await this.assertRole(id, userId, ['owner', 'manager']);
    if (input.inn && !OrganizationsService.validInn(input.inn)) throw Errors.badRequest('invalid_inn', 'Некорректный ИНН');
    // Смена ИНН снимает отметку о проверке.
    const patch: Partial<typeof organizations.$inferInsert> = { ...input, updatedAt: new Date() };
    if (input.inn) patch.verifiedAt = null;
    await this.db.update(organizations).set(patch).where(eq(organizations.id, id));
    return this.get(id);
  }

  async members(userId: string, id: string) {
    await this.assertRole(id, userId, ['owner', 'manager']);
    return this.db
      .select({ userId: users.id, displayName: users.displayName, email: users.email, role: organizationMembers.role })
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(eq(organizationMembers.organizationId, id));
  }

  async addMember(userId: string, id: string, email: string) {
    await this.assertRole(id, userId, ['owner']);
    const [u] = await this.db.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (!u) throw Errors.notFound('Пользователь с таким email');
    await this.db.insert(organizationMembers).values({ organizationId: id, userId: u.id, role: 'manager' }).onConflictDoNothing();
    return this.members(userId, id);
  }

  async removeMember(userId: string, id: string, memberId: string) {
    await this.assertRole(id, userId, ['owner']);
    if (memberId === userId) throw Errors.badRequest('owner_remove', 'Владелец не может удалить себя');
    await this.db.delete(organizationMembers).where(and(eq(organizationMembers.organizationId, id), eq(organizationMembers.userId, memberId)));
  }
}
