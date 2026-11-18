import { z } from 'zod';
import {
  ATTRIBUTE_TYPES,
  COMPLAINT_REASONS,
  COMPLAINT_STATUSES,
  COMPLAINT_TARGETS,
  CONTACT_METHODS,
  DELIVERY_METHODS,
  ITEM_CONDITIONS,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_GROUPS,
  PLATFORMS,
  PRICE_TYPES,
  REGION_TYPES,
  ROLES,
  SEARCH_SORTS,
  SERVICE_TYPES,
  VERTICALS,
} from '../enums';

/* ----------------------------- общие ----------------------------- */

export const uuid = z.uuid();
export const email = z.email('Некорректный email').max(254).transform((v) => v.trim().toLowerCase());
/** Российский номер в формате E.164: +7XXXXXXXXXX. Принимаем 8XXXXXXXXXX и нормализуем. */
export const phone = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s()-]/g, ''))
  .transform((v) => (/^8\d{10}$/.test(v) ? `+7${v.slice(1)}` : v))
  .refine((v) => /^\+7\d{10}$/.test(v), 'Номер телефона в формате +7XXXXXXXXXX');
export const password = z
  .string()
  .min(8, 'Минимум 8 символов')
  .max(128)
  .refine((v) => /[A-Za-zА-Яа-я]/.test(v) && /\d/.test(v), 'Пароль должен содержать буквы и цифры');

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type PaginationQuery = z.infer<typeof paginationQuery>;

export const cursorQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

/* ----------------------------- auth ----------------------------- */

export const registerSchema = z.object({
  email,
  password,
  displayName: z.string().trim().min(2).max(60),
  acceptTerms: z.literal(true, { error: 'Необходимо принять условия' }),
  acceptPersonalData: z.literal(true, { error: 'Необходимо согласие на обработку персональных данных' }),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(128),
  deviceName: z.string().max(100).optional(),
  platform: z.enum(PLATFORMS).optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const verifyEmailSchema = z.object({ token: z.string().min(16).max(200) });
export const resendVerificationSchema = z.object({ email });

export const phoneRequestSchema = z.object({ phone });
export const phoneVerifySchema = z.object({
  phone,
  code: z.string().regex(/^\d{6}$/, 'Код из 6 цифр'),
  deviceName: z.string().max(100).optional(),
  platform: z.enum(PLATFORMS).optional(),
  /** Обязательно для новых пользователей (регистрация по телефону). */
  acceptTerms: z.boolean().optional(),
  displayName: z.string().trim().min(2).max(60).optional(),
});

export const passwordResetRequestSchema = z.object({ email });
export const passwordResetConfirmSchema = z.object({ token: z.string().min(16).max(200), password });
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: password });

export const refreshSchema = z.object({ refreshToken: z.string().min(20).max(300).optional() });

/* ----------------------------- users ----------------------------- */

export const updateProfileSchema = z.object({
  displayName: z.string().trim().min(2).max(60).optional(),
  about: z.string().trim().max(1000).nullable().optional(),
  cityId: z.number().int().positive().nullable().optional(),
  avatarMediaId: uuid.nullable().optional(),
  showPhone: z.boolean().optional(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const attachPhoneSchema = phoneVerifySchema.pick({ phone: true, code: true });

export const notificationPreferencesSchema = z.object({
  preferences: z
    .array(z.object({ group: z.enum(NOTIFICATION_GROUPS), channel: z.enum(NOTIFICATION_CHANNELS), enabled: z.boolean() }))
    .max(100),
});

export const pushTokenSchema = z.object({ token: z.string().min(10).max(300), platform: z.enum(PLATFORMS) });

/* ----------------------------- organizations ----------------------------- */

const inn = z.string().regex(/^(\d{10}|\d{12})$/, 'ИНН — 10 или 12 цифр');
export const organizationSchema = z.object({
  name: z.string().trim().min(2).max(200),
  inn,
  ogrn: z.string().regex(/^(\d{13}|\d{15})$/, 'ОГРН — 13 или 15 цифр').optional(),
  legalAddress: z.string().trim().max(500).optional(),
  description: z.string().trim().max(3000).optional(),
  website: z.url().max(300).optional(),
  logoMediaId: uuid.nullable().optional(),
  cityId: z.number().int().positive().optional(),
});
export type OrganizationInput = z.infer<typeof organizationSchema>;

/* ----------------------------- categories / attributes ----------------------------- */

export const attributeValue = z.union([z.string().max(500), z.number(), z.boolean(), z.array(z.string().max(100)).max(50)]);
export type AttributeValue = z.infer<typeof attributeValue>;

export const categorySchema = z.object({
  parentId: z.number().int().positive().nullable().optional(),
  slug: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .min(2)
    .max(80),
  name: z.string().trim().min(2).max(120),
  vertical: z.enum(VERTICALS),
  icon: z.string().max(60).optional(),
  sort: z.number().int().default(0),
  isActive: z.boolean().default(true),
  freeListingLimit: z.number().int().min(0).max(1000).nullable().optional(),
  requiresManualModeration: z.boolean().default(false),
  allowDelivery: z.boolean().default(true),
  allowVideo: z.boolean().default(false),
  maxPhotos: z.number().int().min(1).max(50).default(20),
});
export type CategoryInput = z.infer<typeof categorySchema>;

export const attributeSchema = z.object({
  key: z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/)
    .max(60),
  name: z.string().trim().min(1).max(120),
  type: z.enum(ATTRIBUTE_TYPES),
  unit: z.string().max(20).nullable().optional(),
  minValue: z.number().nullable().optional(),
  maxValue: z.number().nullable().optional(),
  dependsOnAttributeId: z.number().int().positive().nullable().optional(),
  options: z
    .array(z.object({ value: z.string().regex(/^[a-z0-9_.-]+$/i).max(100), label: z.string().max(120), parentValue: z.string().max(100).optional() }))
    .max(2000)
    .optional(),
});
export type AttributeInput = z.infer<typeof attributeSchema>;

export const categoryAttributeSchema = z.object({
  attributeId: z.number().int().positive(),
  isRequired: z.boolean().default(false),
  isFilterable: z.boolean().default(true),
  showInCard: z.boolean().default(true),
  sort: z.number().int().default(0),
});

export const regionSchema = z.object({
  parentId: z.number().int().positive().nullable().optional(),
  type: z.enum(REGION_TYPES),
  name: z.string().trim().min(2).max(120),
  slug: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .max(80),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  timezone: z.string().max(60).optional(),
  sort: z.number().int().default(0),
  isActive: z.boolean().default(true),
});

/* ----------------------------- listings ----------------------------- */

/** Поля объявления без значений по умолчанию (для частичного обновления). */
const listingFields = {
  categoryId: z.number().int().positive(),
  title: z.string().trim().min(3, 'Минимум 3 символа').max(120),
  description: z.string().trim().max(7500),
  price: z.number().int().min(0).max(1_000_000_000_000).nullable(),
  priceType: z.enum(PRICE_TYPES),
  condition: z.enum(ITEM_CONDITIONS).nullable(),
  cityId: z.number().int().positive(),
  address: z.string().trim().max(300).nullable(),
  lat: z.number().min(-90).max(90).nullable(),
  lng: z.number().min(-180).max(180).nullable(),
  contactMethods: z.array(z.enum(CONTACT_METHODS)).min(1).max(2),
  deliveryAvailable: z.boolean(),
  quantity: z.number().int().min(1).max(10000),
  attributes: z.record(z.string().max(60), attributeValue),
  mediaIds: z.array(uuid).max(50),
  videoUrl: z
    .url()
    .max(300)
    .refine((u) => /^https:\/\/(www\.)?(rutube\.ru|vk\.com|vkvideo\.ru|youtube\.com|youtu\.be)\//.test(u), 'Поддерживаются ссылки RuTube, VK Видео, YouTube')
    .nullable(),
  organizationId: uuid.nullable(),
};

export const createListingSchema = z.object({
  ...listingFields,
  description: listingFields.description.default(''),
  price: listingFields.price.optional(),
  priceType: listingFields.priceType.default('fixed'),
  condition: listingFields.condition.optional(),
  address: listingFields.address.optional(),
  lat: listingFields.lat.optional(),
  lng: listingFields.lng.optional(),
  contactMethods: listingFields.contactMethods.default(['chat']),
  deliveryAvailable: listingFields.deliveryAvailable.default(false),
  quantity: listingFields.quantity.default(1),
  attributes: listingFields.attributes.default({}),
  mediaIds: listingFields.mediaIds.default([]),
  videoUrl: listingFields.videoUrl.optional(),
  organizationId: listingFields.organizationId.optional(),
});
export const listingBaseSchema = createListingSchema;
export type CreateListingInput = z.infer<typeof createListingSchema>;
export const updateListingSchema = z.object(listingFields).partial().extend({ version: z.number().int().min(1) });
export type UpdateListingInput = z.infer<typeof updateListingSchema>;

export const listingActionSchema = z.object({ reason: z.string().max(500).optional() });

export const searchQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  cityId: z.coerce.number().int().positive().optional(),
  priceMin: z.coerce.number().int().min(0).optional(),
  priceMax: z.coerce.number().int().min(0).optional(),
  condition: z.enum(ITEM_CONDITIONS).optional(),
  delivery: z.coerce.boolean().optional(),
  withPhoto: z.coerce.boolean().optional(),
  sellerId: uuid.optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  radiusKm: z.coerce.number().min(0.1).max(500).optional(),
  /** Прямоугольник карты: south,west,north,east */
  bbox: z
    .string()
    .regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?$/)
    .optional(),
  /** Фильтры по атрибутам: attr.<key>=v1,v2 | attr.<key>.min=… | attr.<key>.max=… */
  attrs: z.record(z.string(), z.string().max(500)).default({}),
  sort: z.enum(SEARCH_SORTS).default('relevance'),
  page: z.coerce.number().int().min(1).max(100).default(1),
  limit: z.coerce.number().int().min(1).max(60).default(30),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

export const savedSearchSchema = z.object({
  name: z.string().trim().min(1).max(120),
  query: searchQuerySchema.omit({ page: true, limit: true }).partial(),
  notify: z.boolean().default(true),
});

/* ----------------------------- chat ----------------------------- */

export const startConversationSchema = z.object({ listingId: uuid, message: z.string().trim().min(1).max(4000) });
export const sendMessageSchema = z
  .object({
    body: z.string().trim().max(4000).default(''),
    attachmentMediaId: uuid.optional(),
    clientMessageId: z.string().max(64).optional(),
  })
  .refine((m) => m.body.length > 0 || m.attachmentMediaId, 'Пустое сообщение');
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

/* ----------------------------- reviews / complaints ----------------------------- */

export const createReviewSchema = z.object({
  orderId: uuid.optional(),
  listingId: uuid.optional(),
  rating: z.number().int().min(1).max(5),
  text: z.string().trim().max(2000).default(''),
}).refine((r) => r.orderId || r.listingId, 'Укажите заказ или объявление');

export const createComplaintSchema = z.object({
  targetType: z.enum(COMPLAINT_TARGETS),
  targetId: z.string().min(1).max(64),
  reason: z.enum(COMPLAINT_REASONS),
  comment: z.string().trim().max(2000).optional(),
});

export const resolveComplaintSchema = z.object({
  status: z.enum(COMPLAINT_STATUSES).exclude(['new']),
  resolution: z.string().trim().max(2000).optional(),
  blockTarget: z.boolean().default(false),
});

/* ----------------------------- orders / payments ----------------------------- */

export const deliveryAddressSchema = z.object({
  recipientName: z.string().trim().min(2).max(120),
  recipientPhone: phone,
  city: z.string().trim().min(2).max(120),
  address: z.string().trim().min(5).max(300),
  pickupPointId: z.string().max(60).optional(),
  comment: z.string().max(500).optional(),
});

export const createOrderSchema = z
  .object({
    listingId: uuid,
    quantity: z.number().int().min(1).max(100).default(1),
    deliveryMethod: z.enum(DELIVERY_METHODS),
    deliveryProvider: z.string().max(40).optional(),
    deliveryAddress: deliveryAddressSchema.optional(),
    payOnline: z.boolean().default(true),
    comment: z.string().max(1000).optional(),
  })
  .refine((o) => o.deliveryMethod === 'pickup' || o.deliveryAddress, { message: 'Укажите адрес доставки', path: ['deliveryAddress'] })
  .refine((o) => o.deliveryMethod === 'pickup' || o.payOnline, { message: 'Доставка доступна только с онлайн-оплатой', path: ['payOnline'] });
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const orderActionSchema = z.object({
  reason: z.string().max(500).optional(),
  trackingNumber: z.string().max(60).optional(),
});

export const deliveryQuoteSchema = z.object({ listingId: uuid, city: z.string().min(2).max(120) });

export const purchaseServiceSchema = z.object({
  serviceCode: z.string().max(60),
  listingId: uuid.optional(),
  /** Оплата бонусным балансом (если разрешено правилами услуги). */
  useBonus: z.boolean().default(false),
});

export const refundSchema = z.object({ amount: z.number().int().positive().optional(), reason: z.string().max(500) });

/* ----------------------------- admin ----------------------------- */

export const paidServiceSchema = z.object({
  code: z
    .string()
    .regex(/^[a-z0-9_]+$/)
    .max(60),
  type: z.enum(SERVICE_TYPES),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).default(''),
  price: z.number().int().min(0),
  durationDays: z.number().int().min(0).max(366).nullable().optional(),
  quantity: z.number().int().min(1).max(10000).nullable().optional(),
  categoryId: z.number().int().positive().nullable().optional(),
  isActive: z.boolean().default(true),
  bonusAllowed: z.boolean().default(false),
  sort: z.number().int().default(0),
});
export type PaidServiceInput = z.infer<typeof paidServiceSchema>;

export const blockUserSchema = z.object({ reason: z.string().trim().min(3).max(500), until: z.iso.datetime().optional() });
export const assignRolesSchema = z.object({ roles: z.array(z.enum(ROLES)).max(5) });
export const moderationDecisionSchema = z.object({
  decision: z.enum(['approve', 'reject', 'block']),
  reason: z.string().trim().max(1000).optional(),
});
export const stopWordSchema = z.object({
  word: z.string().trim().min(2).max(100),
  action: z.enum(['reject', 'flag']),
});
export const platformSettingSchema = z.object({ value: z.unknown() });
export const adPlacementSchema = z.object({
  slot: z.enum(['home_top', 'search_inline', 'listing_sidebar']),
  title: z.string().trim().min(2).max(120),
  imageUrl: z.url().max(500),
  targetUrl: z.url().max(500),
  advertiser: z.string().trim().min(2).max(200),
  advertiserInn: z.string().regex(/^(\d{10}|\d{12})$/),
  /** Идентификатор рекламы из ОРД (обязателен по 347-ФЗ ст. 18.1). */
  erid: z.string().trim().min(4).max(60),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  isActive: z.boolean().default(true),
});
