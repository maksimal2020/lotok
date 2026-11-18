import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray, isNotNull, isNull, lt, ne, or, sql, sum } from 'drizzle-orm';
import type { ConversationDto, MessageDto, SendMessageInput } from '@lotok/shared';
import { DB, type Db } from '../../database/database.module';
import { conversationParticipants, conversations, listingMedia, listings, media, messages, userBlocks, users } from '../../database/schema';
import { RateLimitService } from '../../infra/redis.module';
import { RealtimeService, SettingsService } from '../../infra/platform.services';
import { StorageService } from '../../infra/storage.service';
import { Errors } from '../../common/errors';
import { iso } from '../../common/util';
import { mediaUrls, presentMedia } from '../media/media.presenter';
import { ListingsService } from '../listings/listings.service';
import { NotificationsService } from '../notifications/notifications.service';

type MessageRow = typeof messages.$inferSelect;

@Injectable()
export class ChatService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly storage: StorageService,
    private readonly realtime: RealtimeService,
    private readonly limiter: RateLimitService,
    private readonly settings: SettingsService,
    private readonly listings: ListingsService,
    private readonly notifications: NotificationsService,
  ) {}

  private async presentMessage(m: MessageRow): Promise<MessageDto> {
    let attachment = null;
    if (m.attachmentMediaId) {
      const [row] = await this.db.select().from(media).where(eq(media.id, m.attachmentMediaId));
      if (row) attachment = await presentMedia(this.storage, row);
    }
    return {
      id: m.id,
      conversationId: m.conversationId,
      senderId: m.senderId,
      type: m.type,
      body: m.body,
      attachment,
      clientMessageId: m.clientMessageId,
      createdAt: m.createdAt.toISOString(),
      deliveredAt: iso(m.deliveredAt),
      readAt: iso(m.readAt),
    };
  }

  /** Доступ к диалогу только у его участников (защита от IDOR: чужой диалог = 404). */
  async assertParticipant(userId: string, conversationId: string) {
    const [c] = await this.db.select().from(conversations).where(eq(conversations.id, conversationId));
    if (!c || (c.buyerId !== userId && c.sellerId !== userId)) throw Errors.notFound('Диалог');
    return { conv: c, counterpartId: c.buyerId === userId ? c.sellerId : c.buyerId, role: (c.buyerId === userId ? 'buyer' : 'seller') as 'buyer' | 'seller' };
  }

  async start(buyerId: string, listingId: string, text: string) {
    const listing = await this.listings.getRow(listingId);
    if (listing.status !== 'active') throw Errors.conflict('listing_unavailable', 'Объявление недоступно');
    if (listing.userId === buyerId) throw Errors.badRequest('own_listing', 'Нельзя написать по своему объявлению');
    if (!(listing.contactMethods as string[]).includes('chat')) throw Errors.forbidden('Продавец не принимает сообщения в чате', 'chat_disabled');
    let [conv] = await this.db
      .select()
      .from(conversations)
      .where(and(eq(conversations.listingId, listingId), eq(conversations.buyerId, buyerId)));
    if (!conv) {
      conv = await this.db.transaction(async (tx) => {
        const [c] = await tx
          .insert(conversations)
          .values({ listingId, buyerId, sellerId: listing.userId })
          .onConflictDoNothing()
          .returning();
        const created =
          c ?? (await tx.select().from(conversations).where(and(eq(conversations.listingId, listingId), eq(conversations.buyerId, buyerId))))[0];
        await tx
          .insert(conversationParticipants)
          .values([
            { conversationId: created.id, userId: buyerId },
            { conversationId: created.id, userId: listing.userId },
          ])
          .onConflictDoNothing();
        return created;
      });
      await this.listings.registerContact(listingId, buyerId);
    }
    const message = await this.send(buyerId, conv.id, { body: text });
    return { conversationId: conv.id, message };
  }

  async send(senderId: string, conversationId: string, input: SendMessageInput): Promise<MessageDto> {
    const { conv, counterpartId } = await this.assertParticipant(senderId, conversationId);
    const perMinute = await this.settings.get('chat.max_messages_per_minute');
    const rl = await this.limiter.hit(`chat:${senderId}`, perMinute, 60);
    if (!rl.allowed) throw Errors.tooMany(rl.retryAfterSec, 'Вы отправляете сообщения слишком часто');
    const blocks = await this.db
      .select()
      .from(userBlocks)
      .where(
        or(
          and(eq(userBlocks.blockerId, senderId), eq(userBlocks.blockedId, counterpartId)),
          and(eq(userBlocks.blockerId, counterpartId), eq(userBlocks.blockedId, senderId)),
        ),
      );
    if (blocks.length) throw Errors.forbidden('Переписка недоступна: один из участников заблокировал другого', 'conversation_blocked');
    const [recipient] = await this.db.select({ status: users.status }).from(users).where(eq(users.id, counterpartId));
    if (recipient?.status !== 'active') throw Errors.conflict('recipient_unavailable', 'Пользователь недоступен');

    let type: MessageRow['type'] = 'text';
    if (input.attachmentMediaId) {
      const [m] = await this.db.select().from(media).where(eq(media.id, input.attachmentMediaId));
      if (!m || m.ownerId !== senderId || m.purpose !== 'chat' || m.status !== 'ready') throw Errors.badRequest('invalid_attachment', 'Вложение недоступно');
      type = m.kind === 'image' ? 'image' : 'document';
    }
    if (input.clientMessageId) {
      const [dup] = await this.db
        .select()
        .from(messages)
        .where(and(eq(messages.senderId, senderId), eq(messages.clientMessageId, input.clientMessageId)));
      if (dup) return this.presentMessage(dup);
    }
    const row = await this.db.transaction(async (tx) => {
      const [m] = await tx
        .insert(messages)
        .values({ conversationId, senderId, type, body: input.body, attachmentMediaId: input.attachmentMediaId ?? null, clientMessageId: input.clientMessageId ?? null })
        .onConflictDoNothing()
        .returning();
      if (!m) return null;
      await tx.update(conversations).set({ lastMessageAt: m.createdAt }).where(eq(conversations.id, conversationId));
      await tx
        .update(conversationParticipants)
        .set({ unreadCount: sql`${conversationParticipants.unreadCount} + 1`, archivedAt: null })
        .where(and(eq(conversationParticipants.conversationId, conversationId), eq(conversationParticipants.userId, counterpartId)));
      return m;
    });
    if (!row) {
      const [dup] = await this.db
        .select()
        .from(messages)
        .where(and(eq(messages.senderId, senderId), eq(messages.clientMessageId, input.clientMessageId!)));
      return this.presentMessage(dup);
    }
    const dto = await this.presentMessage(row);
    this.realtime.toUsers([senderId, counterpartId], 'message:new', dto);
    const [sender] = await this.db.select({ name: users.displayName }).from(users).where(eq(users.id, senderId));
    const [l] = await this.db.select({ title: listings.title }).from(listings).where(eq(listings.id, conv.listingId));
    await this.notifications.notify(counterpartId, {
      type: 'message.new',
      group: 'messages',
      title: `${sender?.name ?? 'Собеседник'} · ${l?.title ?? ''}`.slice(0, 200),
      body: type === 'text' ? input.body.slice(0, 200) : type === 'image' ? '📷 Фото' : '📎 Документ',
      data: { conversationId },
      skipInApp: true,
    });
    return dto;
  }

  async list(userId: string, opts: { archived: boolean; q?: string; limit: number; cursor?: string }): Promise<{ items: ConversationDto[]; nextCursor: string | null }> {
    const conds = [eq(conversationParticipants.userId, userId), isNotNull(conversations.lastMessageAt)];
    conds.push(opts.archived ? isNotNull(conversationParticipants.archivedAt) : isNull(conversationParticipants.archivedAt));
    if (opts.cursor) conds.push(lt(conversations.lastMessageAt, new Date(opts.cursor)));
    if (opts.q) {
      const q = opts.q.slice(0, 100);
      conds.push(
        or(
          sql`${listings.title} ILIKE ${`%${q.replace(/[\\%_]/g, '\\$&')}%`}`,
          sql`EXISTS (SELECT 1 FROM messages mm WHERE mm.conversation_id = ${conversations.id} AND mm.body_tsv @@ plainto_tsquery('russian', ${q}))`,
        )!,
      );
    }
    const rows = await this.db
      .select({ c: conversations, p: conversationParticipants, l: listings })
      .from(conversationParticipants)
      .innerJoin(conversations, eq(conversations.id, conversationParticipants.conversationId))
      .innerJoin(listings, eq(listings.id, conversations.listingId))
      .where(and(...conds))
      .orderBy(desc(conversations.lastMessageAt))
      .limit(opts.limit + 1);
    const page = rows.slice(0, opts.limit);
    const items = await this.presentConversations(userId, page);
    return { items, nextCursor: rows.length > opts.limit ? (page[page.length - 1].c.lastMessageAt?.toISOString() ?? null) : null };
  }

  private async presentConversations(
    userId: string,
    rows: { c: typeof conversations.$inferSelect; p: typeof conversationParticipants.$inferSelect; l: typeof listings.$inferSelect }[],
  ): Promise<ConversationDto[]> {
    if (!rows.length) return [];
    const convIds = rows.map((r) => r.c.id);
    const counterpartIds = rows.map((r) => (r.c.buyerId === userId ? r.c.sellerId : r.c.buyerId));
    const [lastMessages, people, photos, blocks] = await Promise.all([
      this.db.execute<{ id: string }>(
        sql`SELECT DISTINCT ON (conversation_id) id FROM messages WHERE conversation_id IN (${sql.join(convIds.map((i) => sql`${i}`), sql`, `)}) ORDER BY conversation_id, created_at DESC`,
      ),
      this.db
        .select({ id: users.id, displayName: users.displayName, avatar: users.avatarMediaId, lastSeenAt: users.lastSeenAt })
        .from(users)
        .where(inArray(users.id, counterpartIds)),
      this.db
        .select({ listingId: listingMedia.listingId, variants: media.variants, status: media.status })
        .from(listingMedia)
        .innerJoin(media, eq(media.id, listingMedia.mediaId))
        .where(and(inArray(listingMedia.listingId, rows.map((r) => r.l.id)), eq(listingMedia.position, 0))),
      this.db
        .select()
        .from(userBlocks)
        .where(or(and(eq(userBlocks.blockerId, userId), inArray(userBlocks.blockedId, counterpartIds)), and(inArray(userBlocks.blockerId, counterpartIds), eq(userBlocks.blockedId, userId)))),
    ]);
    const msgRows = lastMessages.rows.length
      ? await this.db.select().from(messages).where(inArray(messages.id, lastMessages.rows.map((r) => r.id)))
      : [];
    const avatarIds = people.map((p) => p.avatar).filter((x): x is string => !!x);
    const avatars = avatarIds.length ? await this.db.select().from(media).where(inArray(media.id, avatarIds)) : [];
    const out: ConversationDto[] = [];
    for (const r of rows) {
      const cp = r.c.buyerId === userId ? r.c.sellerId : r.c.buyerId;
      const person = people.find((p) => p.id === cp);
      const last = msgRows.find((m) => m.conversationId === r.c.id);
      const photo = photos.find((p) => p.listingId === r.l.id);
      out.push({
        id: r.c.id,
        listing: { id: r.l.id, title: r.l.title, price: r.l.price, status: r.l.status, photo: photo ? mediaUrls(this.storage, photo) : null },
        counterpart: {
          id: cp,
          displayName: person?.displayName ?? 'Пользователь',
          avatarUrl: mediaUrls(this.storage, avatars.find((a) => a.id === person?.avatar))?.thumb ?? null,
          lastSeenAt: iso(person?.lastSeenAt),
        },
        role: r.c.buyerId === userId ? 'buyer' : 'seller',
        lastMessage: last ? await this.presentMessage(last) : null,
        unreadCount: r.p.unreadCount,
        archived: !!r.p.archivedAt,
        blockedByMe: blocks.some((b) => b.blockerId === userId && b.blockedId === cp),
        blockedMe: blocks.some((b) => b.blockerId === cp && b.blockedId === userId),
        updatedAt: (r.c.lastMessageAt ?? r.c.createdAt).toISOString(),
      });
    }
    return out;
  }

  async getConversation(userId: string, id: string): Promise<ConversationDto> {
    await this.assertParticipant(userId, id);
    const rows = await this.db
      .select({ c: conversations, p: conversationParticipants, l: listings })
      .from(conversationParticipants)
      .innerJoin(conversations, eq(conversations.id, conversationParticipants.conversationId))
      .innerJoin(listings, eq(listings.id, conversations.listingId))
      .where(and(eq(conversationParticipants.conversationId, id), eq(conversationParticipants.userId, userId)));
    return (await this.presentConversations(userId, rows))[0];
  }

  async messages(userId: string, conversationId: string, before: string | undefined, limit: number) {
    await this.assertParticipant(userId, conversationId);
    const cond = before
      ? and(eq(messages.conversationId, conversationId), lt(messages.createdAt, new Date(before)))
      : eq(messages.conversationId, conversationId);
    const rows = await this.db.select().from(messages).where(cond).orderBy(desc(messages.createdAt)).limit(limit + 1);
    const page = rows.slice(0, limit);
    return {
      items: (await Promise.all(page.map((m) => this.presentMessage(m)))).reverse(),
      nextCursor: rows.length > limit ? page[page.length - 1].createdAt.toISOString() : null,
    };
  }

  async markDelivered(userId: string, conversationId: string) {
    const { counterpartId } = await this.assertParticipant(userId, conversationId);
    const updated = await this.db
      .update(messages)
      .set({ deliveredAt: new Date() })
      .where(and(eq(messages.conversationId, conversationId), eq(messages.senderId, counterpartId), isNull(messages.deliveredAt)))
      .returning({ id: messages.id });
    if (updated.length) this.realtime.toUser(counterpartId, 'message:delivered', { conversationId, messageIds: updated.map((u) => u.id), at: new Date().toISOString() });
    return updated.length;
  }

  async markRead(userId: string, conversationId: string) {
    const { counterpartId } = await this.assertParticipant(userId, conversationId);
    const now = new Date();
    const updated = await this.db.transaction(async (tx) => {
      const u = await tx
        .update(messages)
        .set({ readAt: now, deliveredAt: sql`coalesce(${messages.deliveredAt}, ${now.toISOString()}::timestamptz)` })
        .where(and(eq(messages.conversationId, conversationId), eq(messages.senderId, counterpartId), isNull(messages.readAt)))
        .returning({ id: messages.id });
      await tx
        .update(conversationParticipants)
        .set({ unreadCount: 0, lastReadAt: now })
        .where(and(eq(conversationParticipants.conversationId, conversationId), eq(conversationParticipants.userId, userId)));
      return u;
    });
    if (updated.length) this.realtime.toUser(counterpartId, 'message:read', { conversationId, messageIds: updated.map((u) => u.id), at: now.toISOString() });
    this.realtime.toUser(userId, 'conversation:read', { conversationId });
    return updated.length;
  }

  async setArchived(userId: string, conversationId: string, archived: boolean) {
    await this.assertParticipant(userId, conversationId);
    await this.db
      .update(conversationParticipants)
      .set({ archivedAt: archived ? new Date() : null })
      .where(and(eq(conversationParticipants.conversationId, conversationId), eq(conversationParticipants.userId, userId)));
  }

  async unreadTotal(userId: string) {
    const [r] = await this.db
      .select({ total: sum(conversationParticipants.unreadCount), dialogs: count() })
      .from(conversationParticipants)
      .where(and(eq(conversationParticipants.userId, userId), ne(conversationParticipants.unreadCount, 0)));
    return { messages: Number(r.total ?? 0), conversations: r.dialogs };
  }

  async searchMessages(userId: string, q: string, limit = 30) {
    const rows = await this.db
      .select({ m: messages })
      .from(messages)
      .innerJoin(conversationParticipants, and(eq(conversationParticipants.conversationId, messages.conversationId), eq(conversationParticipants.userId, userId)))
      .where(sql`${messages.bodyTsv} @@ plainto_tsquery('russian', ${q.slice(0, 200)})`)
      .orderBy(desc(messages.createdAt))
      .limit(limit);
    return Promise.all(rows.map((r) => this.presentMessage(r.m)));
  }

  async typing(userId: string, conversationId: string) {
    const { counterpartId } = await this.assertParticipant(userId, conversationId);
    this.realtime.toUser(counterpartId, 'typing', { conversationId, userId });
  }
}
