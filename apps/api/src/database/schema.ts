import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  check,
  customType,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  unique,
  uuid,
  varchar,
  inet,
} from 'drizzle-orm/pg-core';
import {
  ATTRIBUTE_TYPES,
  COMPLAINT_REASONS,
  COMPLAINT_STATUSES,
  COMPLAINT_TARGETS,
  DELIVERY_METHODS,
  ITEM_CONDITIONS,
  LISTING_STATUSES,
  MEDIA_KINDS,
  MEDIA_STATUSES,
  MESSAGE_TYPES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_GROUPS,
  ORDER_PAYMENT_STATUSES,
  ORDER_STATUSES,
  ORG_MEMBER_ROLES,
  PAYMENT_PURPOSES,
  PAYMENT_STATUSES,
  PLATFORMS,
  PRICE_TYPES,
  PROMOTION_TYPES,
  PURCHASE_STATUSES,
  REGION_TYPES,
  REVIEW_STATUSES,
  ROLES,
  SERVICE_TYPES,
  USER_STATUSES,
  VERTICALS,
} from '@lotok/shared';

const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
};
const money = (name?: string) => (name ? bigint(name, { mode: 'number' }) : bigint({ mode: 'number' }));

/* ============================== enums ============================== */

export const roleEnum = pgEnum('role', ROLES);
export const userStatusEnum = pgEnum('user_status', USER_STATUSES);
export const verticalEnum = pgEnum('vertical', VERTICALS);
export const listingStatusEnum = pgEnum('listing_status', LISTING_STATUSES);
export const priceTypeEnum = pgEnum('price_type', PRICE_TYPES);
export const conditionEnum = pgEnum('item_condition', ITEM_CONDITIONS);
export const attributeTypeEnum = pgEnum('attribute_type', ATTRIBUTE_TYPES);
export const mediaKindEnum = pgEnum('media_kind', MEDIA_KINDS);
export const mediaStatusEnum = pgEnum('media_status', MEDIA_STATUSES);
export const messageTypeEnum = pgEnum('message_type', MESSAGE_TYPES);
export const orderStatusEnum = pgEnum('order_status', ORDER_STATUSES);
export const orderPaymentStatusEnum = pgEnum('order_payment_status', ORDER_PAYMENT_STATUSES);
export const deliveryMethodEnum = pgEnum('delivery_method', DELIVERY_METHODS);
export const paymentStatusEnum = pgEnum('payment_status', PAYMENT_STATUSES);
export const paymentPurposeEnum = pgEnum('payment_purpose', PAYMENT_PURPOSES);
export const serviceTypeEnum = pgEnum('service_type', SERVICE_TYPES);
export const promotionTypeEnum = pgEnum('promotion_type', PROMOTION_TYPES);
export const purchaseStatusEnum = pgEnum('purchase_status', PURCHASE_STATUSES);
export const complaintTargetEnum = pgEnum('complaint_target', COMPLAINT_TARGETS);
export const complaintReasonEnum = pgEnum('complaint_reason', COMPLAINT_REASONS);
export const complaintStatusEnum = pgEnum('complaint_status', COMPLAINT_STATUSES);
export const reviewStatusEnum = pgEnum('review_status', REVIEW_STATUSES);
export const notificationChannelEnum = pgEnum('notification_channel', NOTIFICATION_CHANNELS);
export const notificationGroupEnum = pgEnum('notification_group', NOTIFICATION_GROUPS);
export const regionTypeEnum = pgEnum('region_type', REGION_TYPES);
export const orgMemberRoleEnum = pgEnum('org_member_role', ORG_MEMBER_ROLES);
export const platformEnum = pgEnum('client_platform', PLATFORMS);
export const authCodeTypeEnum = pgEnum('auth_code_type', ['email_verify', 'password_reset', 'phone_login', 'phone_attach']);
export const ledgerAccountTypeEnum = pgEnum('ledger_account_type', [
  'provider_clearing', // деньги у платёжного провайдера (отражение входящих платежей)
  'platform_revenue', // выручка платформы: услуги, комиссии
  'seller_payable', // обязательства перед продавцами (средства пользователей, не выручка)
  'user_bonus', // бонусный (нереальный) баланс пользователя
  'bonus_issued', // контрсчёт выпуска бонусов (расход на маркетинг)
  'refunds', // возвраты покупателям
]);

/* ============================== geo ============================== */

export const regions = pgTable(
  'regions',
  {
    id: serial().primaryKey(),
    parentId: integer().references((): any => regions.id, { onDelete: 'restrict' }),
    type: regionTypeEnum().notNull(),
    countryCode: varchar({ length: 2 }).notNull().default('RU'),
    name: varchar({ length: 120 }).notNull(),
    slug: varchar({ length: 80 }).notNull(),
    lat: doublePrecision(),
    lng: doublePrecision(),
    timezone: varchar({ length: 60 }),
    sort: integer().notNull().default(0),
    isActive: boolean().notNull().default(true),
  },
  (t) => [uniqueIndex('regions_slug_uq').on(t.countryCode, t.slug), index('regions_parent_idx').on(t.parentId)],
);

/* ============================== users & auth ============================== */

export const users = pgTable(
  'users',
  {
    id: uuid().primaryKey().defaultRandom(),
    email: varchar({ length: 254 }),
    emailVerifiedAt: timestamp({ withTimezone: true }),
    phone: varchar({ length: 16 }),
    phoneVerifiedAt: timestamp({ withTimezone: true }),
    passwordHash: text(),
    displayName: varchar({ length: 60 }).notNull(),
    about: text(),
    avatarMediaId: uuid(),
    cityId: integer().references(() => regions.id, { onDelete: 'set null' }),
    status: userStatusEnum().notNull().default('active'),
    blockedReason: text(),
    blockedUntil: timestamp({ withTimezone: true }),
    showPhone: boolean().notNull().default(false),
    locale: varchar({ length: 10 }).notNull().default('ru-RU'),
    ratingAvg: numeric({ precision: 3, scale: 2, mode: 'number' }),
    ratingCount: integer().notNull().default(0),
    /** Счётчик для инвалидации всех access-токенов («выйти со всех устройств», смена пароля). */
    tokenVersion: integer().notNull().default(1),
    termsAcceptedAt: timestamp({ withTimezone: true }),
    personalDataConsentAt: timestamp({ withTimezone: true }),
    marketingConsentAt: timestamp({ withTimezone: true }),
    lastSeenAt: timestamp({ withTimezone: true }),
    deletedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('users_email_uq').on(t.email),
    uniqueIndex('users_phone_uq').on(t.phone),
    index('users_status_idx').on(t.status),
    check('users_identity_ck', sql`${t.email} IS NOT NULL OR ${t.phone} IS NOT NULL OR ${t.status} = 'deleted'`),
  ],
);

export const userRoles = pgTable(
  'user_roles',
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: roleEnum().notNull(),
    grantedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.role] })],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** sha256 от текущего refresh-токена. Сам токен не хранится. */
    refreshTokenHash: varchar({ length: 64 }).notNull(),
    /** Хэш предыдущего токена — для обнаружения повторного использования (token reuse). */
    previousTokenHash: varchar({ length: 64 }),
    platform: platformEnum().notNull().default('web'),
    deviceName: varchar({ length: 100 }),
    userAgent: varchar({ length: 400 }),
    ip: inet(),
    lastUsedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    revokedAt: timestamp({ withTimezone: true }),
    revokedReason: varchar({ length: 60 }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('sessions_token_uq').on(t.refreshTokenHash),
    index('sessions_prev_token_idx').on(t.previousTokenHash),
    index('sessions_user_idx').on(t.userId),
  ],
);

export const authCodes = pgTable(
  'auth_codes',
  {
    id: uuid().primaryKey().defaultRandom(),
    type: authCodeTypeEnum().notNull(),
    userId: uuid().references(() => users.id, { onDelete: 'cascade' }),
    /** email или телефон, для которого выдан код */
    target: varchar({ length: 254 }).notNull(),
    codeHash: varchar({ length: 64 }).notNull(),
    attempts: smallint().notNull().default(0),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    consumedAt: timestamp({ withTimezone: true }),
    ip: inet(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('auth_codes_lookup_idx').on(t.type, t.target, t.createdAt), index('auth_codes_hash_idx').on(t.type, t.codeHash)],
);

/** Внешние провайдеры идентификации (VK ID, Яндекс ID, Госуслуги/ЕСИА) — задел на будущее. */
export const externalIdentities = pgTable(
  'external_identities',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: varchar({ length: 40 }).notNull(),
    subject: varchar({ length: 200 }).notNull(),
    profile: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('ext_identity_uq').on(t.provider, t.subject)],
);

export const userBlocks = pgTable(
  'user_blocks',
  {
    blockerId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    blockedId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.blockerId, t.blockedId] }), check('user_blocks_self_ck', sql`${t.blockerId} <> ${t.blockedId}`)],
);

/* ============================== organizations ============================== */

export const organizations = pgTable(
  'organizations',
  {
    id: uuid().primaryKey().defaultRandom(),
    ownerId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    name: varchar({ length: 200 }).notNull(),
    inn: varchar({ length: 12 }).notNull(),
    ogrn: varchar({ length: 15 }),
    legalAddress: varchar({ length: 500 }),
    description: text(),
    website: varchar({ length: 300 }),
    logoMediaId: uuid(),
    cityId: integer().references(() => regions.id, { onDelete: 'set null' }),
    status: varchar({ length: 20 }).notNull().default('active'),
    verifiedAt: timestamp({ withTimezone: true }),
    ratingAvg: numeric({ precision: 3, scale: 2, mode: 'number' }),
    ratingCount: integer().notNull().default(0),
    ...timestamps,
  },
  (t) => [uniqueIndex('organizations_inn_uq').on(t.inn), index('organizations_owner_idx').on(t.ownerId)],
);

export const organizationMembers = pgTable(
  'organization_members',
  {
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: orgMemberRoleEnum().notNull().default('manager'),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.userId] }), index('org_members_user_idx').on(t.userId)],
);

/* ============================== catalog ============================== */

export const categories = pgTable(
  'categories',
  {
    id: serial().primaryKey(),
    parentId: integer().references((): any => categories.id, { onDelete: 'restrict' }),
    slug: varchar({ length: 80 }).notNull(),
    name: varchar({ length: 120 }).notNull(),
    vertical: verticalEnum().notNull(),
    icon: varchar({ length: 60 }),
    sort: integer().notNull().default(0),
    isActive: boolean().notNull().default(true),
    /** Бесплатных публикаций за 30 дней в категории. null — без ограничений. */
    freeListingLimit: integer(),
    requiresManualModeration: boolean().notNull().default(false),
    allowDelivery: boolean().notNull().default(true),
    allowVideo: boolean().notNull().default(false),
    maxPhotos: integer().notNull().default(20),
    ...timestamps,
  },
  (t) => [uniqueIndex('categories_slug_uq').on(t.slug), index('categories_parent_idx').on(t.parentId)],
);

export const attributes = pgTable(
  'attributes',
  {
    id: serial().primaryKey(),
    key: varchar({ length: 60 }).notNull(),
    name: varchar({ length: 120 }).notNull(),
    type: attributeTypeEnum().notNull(),
    unit: varchar({ length: 20 }),
    minValue: doublePrecision(),
    maxValue: doublePrecision(),
    /** Зависимый справочник: например, «модель» зависит от «марки». */
    dependsOnAttributeId: integer().references((): any => attributes.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [uniqueIndex('attributes_key_uq').on(t.key)],
);

export const attributeOptions = pgTable(
  'attribute_options',
  {
    id: serial().primaryKey(),
    attributeId: integer()
      .notNull()
      .references(() => attributes.id, { onDelete: 'cascade' }),
    value: varchar({ length: 100 }).notNull(),
    label: varchar({ length: 120 }).notNull(),
    parentValue: varchar({ length: 100 }),
    sort: integer().notNull().default(0),
  },
  (t) => [uniqueIndex('attribute_options_uq').on(t.attributeId, t.value)],
);

export const categoryAttributes = pgTable(
  'category_attributes',
  {
    categoryId: integer()
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    attributeId: integer()
      .notNull()
      .references(() => attributes.id, { onDelete: 'cascade' }),
    isRequired: boolean().notNull().default(false),
    isFilterable: boolean().notNull().default(true),
    showInCard: boolean().notNull().default(true),
    sort: integer().notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.categoryId, t.attributeId] })],
);

/* ============================== media ============================== */

export const media = pgTable(
  'media',
  {
    id: uuid().primaryKey().defaultRandom(),
    ownerId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: mediaKindEnum().notNull(),
    status: mediaStatusEnum().notNull().default('pending'),
    /** Назначение загрузки: listing | avatar | chat | org_logo */
    purpose: varchar({ length: 20 }).notNull(),
    originalKey: varchar({ length: 300 }).notNull(),
    mime: varchar({ length: 100 }).notNull(),
    size: integer().notNull(),
    width: integer(),
    height: integer(),
    sha256: varchar({ length: 64 }).notNull(),
    fileName: varchar({ length: 255 }),
    variants: jsonb().$type<Record<string, string>>().notNull().default({}),
    error: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('media_owner_idx').on(t.ownerId, t.createdAt)],
);

/* ============================== listings ============================== */

export const listings = pgTable(
  'listings',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    organizationId: uuid().references(() => organizations.id, { onDelete: 'set null' }),
    categoryId: integer()
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
    title: varchar({ length: 120 }).notNull(),
    description: text().notNull().default(''),
    price: money(),
    priceType: priceTypeEnum().notNull().default('fixed'),
    currency: varchar({ length: 3 }).notNull().default('RUB'),
    condition: conditionEnum(),
    status: listingStatusEnum().notNull().default('draft'),
    cityId: integer()
      .notNull()
      .references(() => regions.id, { onDelete: 'restrict' }),
    address: varchar({ length: 300 }),
    lat: doublePrecision(),
    lng: doublePrecision(),
    contactMethods: jsonb().$type<string[]>().notNull().default(['chat']),
    deliveryAvailable: boolean().notNull().default(false),
    quantity: integer().notNull().default(1),
    videoUrl: varchar({ length: 300 }),
    publishedAt: timestamp({ withTimezone: true }),
    /** Время для сортировки «по дате» — меняется при поднятии в выдаче. */
    bumpedAt: timestamp({ withTimezone: true }),
    expiresAt: timestamp({ withTimezone: true }),
    soldAt: timestamp({ withTimezone: true }),
    moderatedAt: timestamp({ withTimezone: true }),
    moderatedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    rejectionReason: text(),
    moderationFlags: jsonb().$type<string[]>().notNull().default([]),
    /** Оплаченная публикация, списанная при отправке на модерацию (возвращается при отклонении). */
    quotaPurchaseId: uuid(),
    viewsCount: integer().notNull().default(0),
    favoritesCount: integer().notNull().default(0),
    contactsCount: integer().notNull().default(0),
    /** Оптимистическая блокировка конкурентных изменений. */
    version: integer().notNull().default(1),
    indexedAt: timestamp({ withTimezone: true }),
    deletedAt: timestamp({ withTimezone: true }),
    searchTsv: tsvector().generatedAlwaysAs(
      sql`setweight(to_tsvector('russian', coalesce(title, '')), 'A') || setweight(to_tsvector('russian', coalesce(description, '')), 'B')`,
    ),
    ...timestamps,
  },
  (t) => [
    index('listings_user_status_idx').on(t.userId, t.status),
    index('listings_feed_idx').on(t.status, t.categoryId, t.bumpedAt.desc()),
    index('listings_city_idx').on(t.status, t.cityId, t.bumpedAt.desc()),
    index('listings_price_idx').on(t.status, t.price),
    index('listings_geo_idx').on(t.lat, t.lng),
    index('listings_moderation_idx').on(t.status, t.updatedAt),
    index('listings_expires_idx').on(t.status, t.expiresAt),
    index('listings_tsv_idx').using('gin', t.searchTsv),
    index('listings_title_trgm_idx').using('gin', sql`${t.title} gin_trgm_ops`),
    check('listings_price_ck', sql`${t.price} IS NULL OR ${t.price} >= 0`),
    check('listings_qty_ck', sql`${t.quantity} >= 0`),
  ],
);

export const listingAttributeValues = pgTable(
  'listing_attribute_values',
  {
    id: bigserial({ mode: 'number' }).primaryKey(),
    listingId: uuid()
      .notNull()
      .references(() => listings.id, { onDelete: 'cascade' }),
    attributeId: integer()
      .notNull()
      .references(() => attributes.id, { onDelete: 'restrict' }),
    valueText: varchar({ length: 500 }),
    valueNumber: doublePrecision(),
    valueBool: boolean(),
  },
  (t) => [
    index('lav_listing_idx').on(t.listingId),
    index('lav_attr_text_idx').on(t.attributeId, t.valueText),
    index('lav_attr_num_idx').on(t.attributeId, t.valueNumber),
  ],
);

export const listingMedia = pgTable(
  'listing_media',
  {
    listingId: uuid()
      .notNull()
      .references(() => listings.id, { onDelete: 'cascade' }),
    mediaId: uuid()
      .notNull()
      .references(() => media.id, { onDelete: 'cascade' }),
    position: smallint().notNull(),
  },
  (t) => [primaryKey({ columns: [t.listingId, t.mediaId] }), uniqueIndex('listing_media_pos_uq').on(t.listingId, t.position)],
);

export const listingStatusHistory = pgTable(
  'listing_status_history',
  {
    id: bigserial({ mode: 'number' }).primaryKey(),
    listingId: uuid()
      .notNull()
      .references(() => listings.id, { onDelete: 'cascade' }),
    fromStatus: listingStatusEnum(),
    toStatus: listingStatusEnum().notNull(),
    action: varchar({ length: 40 }).notNull(),
    actorId: uuid().references(() => users.id, { onDelete: 'set null' }),
    actorType: varchar({ length: 20 }).notNull(),
    reason: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('lsh_listing_idx').on(t.listingId, t.createdAt)],
);

export const listingStatsDaily = pgTable(
  'listing_stats_daily',
  {
    listingId: uuid()
      .notNull()
      .references(() => listings.id, { onDelete: 'cascade' }),
    day: date({ mode: 'string' }).notNull(),
    views: integer().notNull().default(0),
    contacts: integer().notNull().default(0),
    favorites: integer().notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.listingId, t.day] })],
);

export const moderationDecisions = pgTable(
  'moderation_decisions',
  {
    id: bigserial({ mode: 'number' }).primaryKey(),
    listingId: uuid()
      .notNull()
      .references(() => listings.id, { onDelete: 'cascade' }),
    moderatorId: uuid().references(() => users.id, { onDelete: 'set null' }),
    automatic: boolean().notNull(),
    decision: varchar({ length: 20 }).notNull(),
    reason: text(),
    flags: jsonb().$type<string[]>().notNull().default([]),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('moderation_listing_idx').on(t.listingId)],
);

export const stopWords = pgTable(
  'stop_words',
  {
    id: serial().primaryKey(),
    word: varchar({ length: 100 }).notNull(),
    action: varchar({ length: 10 }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('stop_words_uq').on(t.word)],
);

/* ============================== engagement ============================== */

export const favorites = pgTable(
  'favorites',
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    listingId: uuid()
      .notNull()
      .references(() => listings.id, { onDelete: 'cascade' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.listingId] }), index('favorites_listing_idx').on(t.listingId)],
);

export const savedSearches = pgTable(
  'saved_searches',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar({ length: 120 }).notNull(),
    query: jsonb().$type<Record<string, unknown>>().notNull(),
    notify: boolean().notNull().default(true),
    lastCheckedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lastViewedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('saved_searches_user_idx').on(t.userId), index('saved_searches_notify_idx').on(t.notify, t.lastCheckedAt)],
);

/**
 * Интересы пользователя для детерминированных рекомендаций.
 * Хранится агрегат (категория → вес), а не сырые события просмотров.
 */
export const userCategoryInterests = pgTable(
  'user_category_interests',
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    categoryId: integer()
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    score: doublePrecision().notNull().default(0),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.categoryId] })],
);

export const recentViews = pgTable(
  'recent_views',
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    listingId: uuid()
      .notNull()
      .references(() => listings.id, { onDelete: 'cascade' }),
    viewedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.listingId] }), index('recent_views_user_idx').on(t.userId, t.viewedAt)],
);

/* ============================== messaging ============================== */

export const conversations = pgTable(
  'conversations',
  {
    id: uuid().primaryKey().defaultRandom(),
    listingId: uuid()
      .notNull()
      .references(() => listings.id, { onDelete: 'cascade' }),
    buyerId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sellerId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    lastMessageAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('conversations_uq').on(t.listingId, t.buyerId),
    index('conversations_buyer_idx').on(t.buyerId, t.lastMessageAt),
    index('conversations_seller_idx').on(t.sellerId, t.lastMessageAt),
    check('conversations_parties_ck', sql`${t.buyerId} <> ${t.sellerId}`),
  ],
);

export const conversationParticipants = pgTable(
  'conversation_participants',
  {
    conversationId: uuid()
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    unreadCount: integer().notNull().default(0),
    lastReadAt: timestamp({ withTimezone: true }),
    archivedAt: timestamp({ withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.conversationId, t.userId] }), index('conv_part_user_idx').on(t.userId)],
);

export const messages = pgTable(
  'messages',
  {
    id: uuid().primaryKey().defaultRandom(),
    conversationId: uuid()
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    senderId: uuid().references(() => users.id, { onDelete: 'set null' }),
    type: messageTypeEnum().notNull().default('text'),
    body: text().notNull().default(''),
    attachmentMediaId: uuid().references(() => media.id, { onDelete: 'set null' }),
    clientMessageId: varchar({ length: 64 }),
    deliveredAt: timestamp({ withTimezone: true }),
    readAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    bodyTsv: tsvector().generatedAlwaysAs(sql`to_tsvector('russian', coalesce(body, ''))`),
  },
  (t) => [
    index('messages_conv_idx').on(t.conversationId, t.createdAt),
    uniqueIndex('messages_client_id_uq').on(t.senderId, t.clientMessageId),
    index('messages_tsv_idx').using('gin', t.bodyTsv),
  ],
);

/* ============================== notifications ============================== */

export const notifications = pgTable(
  'notifications',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: varchar({ length: 60 }).notNull(),
    group: notificationGroupEnum().notNull(),
    title: varchar({ length: 200 }).notNull(),
    body: text().notNull().default(''),
    data: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    readAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.createdAt)],
);

export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    group: notificationGroupEnum().notNull(),
    channel: notificationChannelEnum().notNull(),
    enabled: boolean().notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.group, t.channel] })],
);

export const pushTokens = pgTable(
  'push_tokens',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: varchar({ length: 300 }).notNull(),
    platform: platformEnum().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('push_tokens_uq').on(t.token)],
);

/* ============================== reviews & complaints ============================== */

export const reviews = pgTable(
  'reviews',
  {
    id: uuid().primaryKey().defaultRandom(),
    authorId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    targetUserId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    listingId: uuid().references(() => listings.id, { onDelete: 'set null' }),
    orderId: uuid().references((): any => orders.id, { onDelete: 'set null' }),
    /** Роль автора в сделке. */
    authorRole: varchar({ length: 10 }).notNull(),
    rating: smallint().notNull(),
    text: text().notNull().default(''),
    status: reviewStatusEnum().notNull().default('published'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('reviews_author_listing_uq').on(t.authorId, t.listingId),
    index('reviews_target_idx').on(t.targetUserId, t.createdAt),
    check('reviews_rating_ck', sql`${t.rating} BETWEEN 1 AND 5`),
    check('reviews_self_ck', sql`${t.authorId} <> ${t.targetUserId}`),
  ],
);

export const complaints = pgTable(
  'complaints',
  {
    id: uuid().primaryKey().defaultRandom(),
    reporterId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    targetType: complaintTargetEnum().notNull(),
    targetId: varchar({ length: 64 }).notNull(),
    reason: complaintReasonEnum().notNull(),
    comment: text(),
    status: complaintStatusEnum().notNull().default('new'),
    resolution: text(),
    handledBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    handledAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('complaints_status_idx').on(t.status, t.createdAt),
    index('complaints_target_idx').on(t.targetType, t.targetId),
    uniqueIndex('complaints_open_uq')
      .on(t.reporterId, t.targetType, t.targetId)
      .where(sql`status IN ('new', 'in_review')`),
  ],
);

/* ============================== commerce ============================== */

export const orders = pgTable(
  'orders',
  {
    id: uuid().primaryKey().defaultRandom(),
    number: varchar({ length: 20 }).notNull(),
    buyerId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    sellerId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    listingId: uuid()
      .notNull()
      .references(() => listings.id, { onDelete: 'restrict' }),
    /** Снимок названия на момент заказа. */
    listingTitle: varchar({ length: 120 }).notNull(),
    quantity: integer().notNull(),
    itemPrice: money().notNull(),
    deliveryPrice: money().notNull().default(0),
    commission: money().notNull().default(0),
    total: money().notNull(),
    currency: varchar({ length: 3 }).notNull().default('RUB'),
    status: orderStatusEnum().notNull(),
    paymentStatus: orderPaymentStatusEnum().notNull(),
    deliveryMethod: deliveryMethodEnum().notNull(),
    deliveryProvider: varchar({ length: 40 }),
    deliveryAddress: jsonb().$type<Record<string, unknown>>(),
    trackingNumber: varchar({ length: 60 }),
    comment: text(),
    cancelReason: text(),
    version: integer().notNull().default(1),
    completedAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('orders_number_uq').on(t.number),
    index('orders_buyer_idx').on(t.buyerId, t.createdAt),
    index('orders_seller_idx').on(t.sellerId, t.createdAt),
    index('orders_status_idx').on(t.status, t.updatedAt),
    check('orders_amounts_ck', sql`${t.total} = ${t.itemPrice} * ${t.quantity} + ${t.deliveryPrice} AND ${t.quantity} > 0`),
  ],
);

export const orderStatusHistory = pgTable(
  'order_status_history',
  {
    id: bigserial({ mode: 'number' }).primaryKey(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    fromStatus: orderStatusEnum(),
    toStatus: orderStatusEnum().notNull(),
    actorId: uuid().references(() => users.id, { onDelete: 'set null' }),
    actorType: varchar({ length: 20 }).notNull(),
    reason: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('osh_order_idx').on(t.orderId, t.createdAt)],
);

export const shipments = pgTable(
  'shipments',
  {
    id: uuid().primaryKey().defaultRandom(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    provider: varchar({ length: 40 }).notNull(),
    providerShipmentId: varchar({ length: 100 }),
    trackingNumber: varchar({ length: 60 }),
    status: varchar({ length: 30 }).notNull().default('created'),
    events: jsonb().$type<Array<{ at: string; status: string; description: string }>>().notNull().default([]),
    ...timestamps,
  },
  (t) => [uniqueIndex('shipments_order_uq').on(t.orderId)],
);

/* ============================== billing ============================== */

export const paidServices = pgTable(
  'paid_services',
  {
    id: serial().primaryKey(),
    code: varchar({ length: 60 }).notNull(),
    type: serviceTypeEnum().notNull(),
    name: varchar({ length: 120 }).notNull(),
    description: text().notNull().default(''),
    price: money().notNull(),
    durationDays: integer(),
    quantity: integer(),
    categoryId: integer().references(() => categories.id, { onDelete: 'set null' }),
    isActive: boolean().notNull().default(true),
    bonusAllowed: boolean().notNull().default(false),
    sort: integer().notNull().default(0),
    ...timestamps,
  },
  (t) => [uniqueIndex('paid_services_code_uq').on(t.code), check('paid_services_price_ck', sql`${t.price} >= 0`)],
);

export const purchases = pgTable(
  'purchases',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    serviceId: integer()
      .notNull()
      .references(() => paidServices.id, { onDelete: 'restrict' }),
    listingId: uuid().references(() => listings.id, { onDelete: 'set null' }),
    /** Снимок цены на момент покупки. */
    price: money().notNull(),
    paidWithBonus: money().notNull().default(0),
    status: purchaseStatusEnum().notNull().default('pending_payment'),
    quantityRemaining: integer(),
    startsAt: timestamp({ withTimezone: true }),
    endsAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [index('purchases_user_idx').on(t.userId, t.createdAt), index('purchases_status_idx').on(t.status, t.endsAt)],
);

export const listingPromotions = pgTable(
  'listing_promotions',
  {
    id: uuid().primaryKey().defaultRandom(),
    listingId: uuid()
      .notNull()
      .references(() => listings.id, { onDelete: 'cascade' }),
    purchaseId: uuid()
      .notNull()
      .references(() => purchases.id, { onDelete: 'cascade' }),
    type: promotionTypeEnum().notNull(),
    startsAt: timestamp({ withTimezone: true }).notNull(),
    endsAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('promotions_active_idx').on(t.listingId, t.type, t.endsAt)],
);

export const payments = pgTable(
  'payments',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    purpose: paymentPurposeEnum().notNull(),
    orderId: uuid().references(() => orders.id, { onDelete: 'restrict' }),
    purchaseId: uuid().references(() => purchases.id, { onDelete: 'restrict' }),
    provider: varchar({ length: 30 }).notNull(),
    providerPaymentId: varchar({ length: 100 }),
    amount: money().notNull(),
    refundedAmount: money().notNull().default(0),
    currency: varchar({ length: 3 }).notNull().default('RUB'),
    status: paymentStatusEnum().notNull().default('pending'),
    description: varchar({ length: 250 }).notNull(),
    /** Ключ идемпотентности клиента (Idempotency-Key). */
    idempotencyKey: varchar({ length: 80 }).notNull(),
    confirmationUrl: text(),
    testMode: boolean().notNull(),
    paidAt: timestamp({ withTimezone: true }),
    metadata: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('payments_idem_uq').on(t.userId, t.idempotencyKey),
    uniqueIndex('payments_provider_uq').on(t.provider, t.providerPaymentId),
    index('payments_user_idx').on(t.userId, t.createdAt),
    index('payments_order_idx').on(t.orderId),
    check('payments_amount_ck', sql`${t.amount} > 0 AND ${t.refundedAmount} >= 0 AND ${t.refundedAmount} <= ${t.amount}`),
    check('payments_target_ck', sql`(${t.purpose} = 'order' AND ${t.orderId} IS NOT NULL) OR (${t.purpose} = 'service' AND ${t.purchaseId} IS NOT NULL)`),
  ],
);

export const paymentEvents = pgTable(
  'payment_events',
  {
    id: bigserial({ mode: 'number' }).primaryKey(),
    paymentId: uuid().references(() => payments.id, { onDelete: 'set null' }),
    provider: varchar({ length: 30 }).notNull(),
    /** Идентификатор события провайдера — защита от повторной обработки webhook. */
    providerEventId: varchar({ length: 150 }).notNull(),
    eventType: varchar({ length: 60 }).notNull(),
    payload: jsonb().$type<Record<string, unknown>>().notNull(),
    signatureValid: boolean().notNull(),
    processedAt: timestamp({ withTimezone: true }),
    error: text(),
    receivedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('payment_events_uq').on(t.provider, t.providerEventId)],
);

export const refunds = pgTable(
  'refunds',
  {
    id: uuid().primaryKey().defaultRandom(),
    paymentId: uuid()
      .notNull()
      .references(() => payments.id, { onDelete: 'restrict' }),
    amount: money().notNull(),
    status: varchar({ length: 20 }).notNull().default('pending'),
    providerRefundId: varchar({ length: 100 }),
    reason: text().notNull(),
    initiatedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    idempotencyKey: varchar({ length: 80 }).notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex('refunds_idem_uq').on(t.idempotencyKey), check('refunds_amount_ck', sql`${t.amount} > 0`)],
);

/**
 * Двойная запись. Каждая операция — ledger_transaction с проводками, сумма которых = 0.
 * Счета разделены по типам: пользовательские средства (seller_payable), выручка (platform_revenue)
 * и бонусы (user_bonus) никогда не смешиваются на одном счёте.
 */
export const ledgerAccounts = pgTable(
  'ledger_accounts',
  {
    id: serial().primaryKey(),
    type: ledgerAccountTypeEnum().notNull(),
    userId: uuid().references(() => users.id, { onDelete: 'restrict' }),
    currency: varchar({ length: 3 }).notNull().default('RUB'),
    balance: money().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('ledger_accounts_uq').on(t.type, t.userId, t.currency).nullsNotDistinct(),
    check('ledger_bonus_nonneg_ck', sql`${t.type} <> 'user_bonus' OR ${t.balance} >= 0`),
  ],
);

export const ledgerTransactions = pgTable(
  'ledger_transactions',
  {
    id: uuid().primaryKey().defaultRandom(),
    kind: varchar({ length: 40 }).notNull(),
    description: varchar({ length: 250 }).notNull(),
    paymentId: uuid().references(() => payments.id, { onDelete: 'restrict' }),
    orderId: uuid().references(() => orders.id, { onDelete: 'restrict' }),
    purchaseId: uuid().references(() => purchases.id, { onDelete: 'restrict' }),
    /** Уникальный ключ операции — исключает двойное проведение. */
    idempotencyKey: varchar({ length: 120 }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('ledger_tx_idem_uq').on(t.idempotencyKey)],
);

export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: bigserial({ mode: 'number' }).primaryKey(),
    transactionId: uuid()
      .notNull()
      .references(() => ledgerTransactions.id, { onDelete: 'restrict' }),
    accountId: integer()
      .notNull()
      .references(() => ledgerAccounts.id, { onDelete: 'restrict' }),
    /** Положительное — дебет, отрицательное — кредит. */
    amount: money().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ledger_entries_account_idx').on(t.accountId, t.createdAt), index('ledger_entries_tx_idx').on(t.transactionId)],
);

export const userSubscriptions = pgTable(
  'user_subscriptions',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purchaseId: uuid()
      .notNull()
      .references(() => purchases.id, { onDelete: 'cascade' }),
    serviceType: serviceTypeEnum().notNull(),
    startsAt: timestamp({ withTimezone: true }).notNull(),
    endsAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('user_subs_active_idx').on(t.userId, t.serviceType, t.endsAt)],
);

export const adPlacements = pgTable(
  'ad_placements',
  {
    id: uuid().primaryKey().defaultRandom(),
    slot: varchar({ length: 40 }).notNull(),
    title: varchar({ length: 120 }).notNull(),
    imageUrl: varchar({ length: 500 }).notNull(),
    targetUrl: varchar({ length: 500 }).notNull(),
    advertiser: varchar({ length: 200 }).notNull(),
    advertiserInn: varchar({ length: 12 }).notNull(),
    erid: varchar({ length: 60 }).notNull(),
    startsAt: timestamp({ withTimezone: true }).notNull(),
    endsAt: timestamp({ withTimezone: true }).notNull(),
    isActive: boolean().notNull().default(true),
    impressions: integer().notNull().default(0),
    clicks: integer().notNull().default(0),
    ...timestamps,
  },
  (t) => [index('ad_placements_slot_idx').on(t.slot, t.isActive, t.endsAt)],
);

/* ============================== platform ============================== */

export const platformSettings = pgTable('platform_settings', {
  key: varchar({ length: 100 }).primaryKey(),
  value: jsonb().notNull(),
  updatedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigserial({ mode: 'number' }).primaryKey(),
    actorId: uuid().references(() => users.id, { onDelete: 'set null' }),
    action: varchar({ length: 80 }).notNull(),
    entityType: varchar({ length: 40 }).notNull(),
    entityId: varchar({ length: 64 }),
    before: jsonb(),
    after: jsonb(),
    ip: inet(),
    userAgent: varchar({ length: 400 }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_actor_idx').on(t.actorId, t.createdAt),
    index('audit_entity_idx').on(t.entityType, t.entityId),
    index('audit_created_idx').on(t.createdAt),
  ],
);

export const securityEvents = pgTable(
  'security_events',
  {
    id: bigserial({ mode: 'number' }).primaryKey(),
    userId: uuid().references(() => users.id, { onDelete: 'set null' }),
    type: varchar({ length: 60 }).notNull(),
    ip: inet(),
    userAgent: varchar({ length: 400 }),
    meta: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('security_events_user_idx').on(t.userId, t.createdAt), index('security_events_type_idx').on(t.type, t.createdAt)],
);
