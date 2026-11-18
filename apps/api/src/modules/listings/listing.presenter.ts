import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, inArray, lte } from 'drizzle-orm';
import type { ListingCard, ListingDetail } from '@lotok/shared';
import { DB, type Db } from '../../database/database.module';
import { favorites, listingAttributeValues, listingMedia, listingPromotions, listings, media } from '../../database/schema';
import { StorageService } from '../../infra/storage.service';
import { mediaUrls, presentMedia } from '../media/media.presenter';
import { CategoriesService } from '../catalog/categories.service';
import { RegionsService } from '../catalog/regions.service';
import { UsersService } from '../users/users.service';
import { iso } from '../../common/util';

export type ListingRow = typeof listings.$inferSelect;

/** Сборка карточек и детальных представлений объявлений пакетными запросами (без N+1). */
@Injectable()
export class ListingPresenter {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly storage: StorageService,
    private readonly regions: RegionsService,
    private readonly categories: CategoriesService,
    private readonly users: UsersService,
  ) {}

  async activePromotions(ids: string[]) {
    if (!ids.length) return [];
    const now = new Date();
    return this.db
      .select({ listingId: listingPromotions.listingId, type: listingPromotions.type, endsAt: listingPromotions.endsAt })
      .from(listingPromotions)
      .where(and(inArray(listingPromotions.listingId, ids), lte(listingPromotions.startsAt, now), gt(listingPromotions.endsAt, now)));
  }

  async cardsByIds(ids: string[], viewerId: string | null, extra: Record<string, { distanceKm?: number | null }> = {}): Promise<ListingCard[]> {
    if (!ids.length) return [];
    const rows = await this.db.select().from(listings).where(inArray(listings.id, ids));
    const byId = new Map(rows.map((r) => [r.id, r]));
    const ordered = ids.map((id) => byId.get(id)).filter((r): r is ListingRow => !!r);
    return this.cards(ordered, viewerId, extra);
  }

  async cards(rows: ListingRow[], viewerId: string | null, extra: Record<string, { distanceKm?: number | null }> = {}): Promise<ListingCard[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const [photos, promos, favs, regions] = await Promise.all([
      this.db
        .select({ listingId: listingMedia.listingId, position: listingMedia.position, variants: media.variants, status: media.status })
        .from(listingMedia)
        .innerJoin(media, eq(media.id, listingMedia.mediaId))
        .where(inArray(listingMedia.listingId, ids))
        .orderBy(asc(listingMedia.position)),
      this.activePromotions(ids),
      viewerId
        ? this.db
            .select({ listingId: favorites.listingId })
            .from(favorites)
            .where(and(eq(favorites.userId, viewerId), inArray(favorites.listingId, ids)))
        : Promise.resolve([]),
      this.regions.all(),
    ]);
    const favSet = new Set(favs.map((f) => f.listingId));
    return rows.map((r) => {
      const ph = photos.filter((p) => p.listingId === r.id && p.status === 'ready');
      const pr = promos.filter((p) => p.listingId === r.id);
      return {
        id: r.id,
        title: r.title,
        price: r.price,
        priceType: r.priceType,
        currency: r.currency,
        condition: r.condition,
        categoryId: r.categoryId,
        cityId: r.cityId,
        cityName: regions.find((g) => g.id === r.cityId)?.name ?? null,
        address: r.address,
        lat: r.lat,
        lng: r.lng,
        photo: ph[0] ? mediaUrls(this.storage, ph[0]) : null,
        photosCount: ph.length,
        publishedAt: iso(r.bumpedAt ?? r.publishedAt),
        deliveryAvailable: r.deliveryAvailable,
        isHighlighted: pr.some((p) => p.type === 'highlight' || p.type === 'premium'),
        isPremium: pr.some((p) => p.type === 'premium'),
        isFavorite: favSet.has(r.id),
        status: r.status,
        sellerId: r.userId,
        ...(extra[r.id] ?? {}),
      };
    });
  }

  async detail(row: ListingRow, viewerId: string | null): Promise<ListingDetail> {
    const [card] = await this.cards([row], viewerId);
    const [photoRows, attrRows, seller, path, promos] = await Promise.all([
      this.db
        .select({ m: media })
        .from(listingMedia)
        .innerJoin(media, eq(media.id, listingMedia.mediaId))
        .where(eq(listingMedia.listingId, row.id))
        .orderBy(asc(listingMedia.position)),
      this.db.select().from(listingAttributeValues).where(eq(listingAttributeValues.listingId, row.id)),
      this.users.getPublic(row.userId),
      this.categories.path(row.categoryId),
      this.activePromotions([row.id]),
    ]);
    const category = await this.categories.get(row.categoryId);
    const isOwner = viewerId === row.userId;
    return {
      ...card,
      description: row.description,
      attributes: await this.categories.displayAttributes(row.categoryId, attrRows),
      photos: await Promise.all(photoRows.filter((p) => isOwner || p.m.status === 'ready').map((p) => presentMedia(this.storage, p.m))),
      videoUrl: row.videoUrl,
      contactMethods: row.contactMethods as ListingDetail['contactMethods'],
      quantity: row.quantity,
      viewsCount: row.viewsCount,
      favoritesCount: row.favoritesCount,
      seller,
      category: { id: category.id, name: category.name, slug: category.slug, vertical: category.vertical, path },
      rejectionReason: isOwner ? row.rejectionReason : null,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      expiresAt: iso(row.expiresAt),
      isOwner,
      canBuy: row.status === 'active' && !isOwner && row.quantity > 0 && row.price !== null && row.price > 0 && ['fixed', 'negotiable'].includes(row.priceType) && category.vertical === 'goods',
      organizationId: row.organizationId,
      promotions: promos.map((p) => ({ type: p.type, endsAt: p.endsAt.toISOString() })),
    };
  }
}
