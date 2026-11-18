/**
 * Перечисления домена. Источник истины для backend (pgEnum), web, admin и mobile.
 * Значения — стабильные машинные коды (не локализованные строки).
 */

export const ROLES = ['super_admin', 'admin', 'moderator', 'support', 'finance'] as const;
export type Role = (typeof ROLES)[number];

export const USER_STATUSES = ['active', 'blocked', 'deleted'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const VERTICALS = ['goods', 'realty', 'auto', 'jobs', 'services'] as const;
export type Vertical = (typeof VERTICALS)[number];

export const LISTING_STATUSES = [
  'draft',
  'moderation',
  'active',
  'rejected',
  'inactive',
  'sold',
  'expired',
  'archived',
  'blocked',
  'deleted',
] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

export const PRICE_TYPES = ['fixed', 'negotiable', 'free', 'on_request'] as const;
export type PriceType = (typeof PRICE_TYPES)[number];

export const ITEM_CONDITIONS = ['new', 'used'] as const;
export type ItemCondition = (typeof ITEM_CONDITIONS)[number];

export const CONTACT_METHODS = ['chat', 'phone'] as const;
export type ContactMethod = (typeof CONTACT_METHODS)[number];

export const ATTRIBUTE_TYPES = ['string', 'integer', 'decimal', 'boolean', 'enum', 'multi_enum', 'year'] as const;
export type AttributeType = (typeof ATTRIBUTE_TYPES)[number];

export const MEDIA_KINDS = ['image', 'video', 'document'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export const MEDIA_STATUSES = ['pending', 'processing', 'ready', 'failed', 'rejected'] as const;
export type MediaStatus = (typeof MEDIA_STATUSES)[number];

export const MESSAGE_TYPES = ['text', 'image', 'document', 'system'] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

export const ORDER_STATUSES = [
  'pending_payment',
  'created',
  'confirmed',
  'shipped',
  'delivered',
  'completed',
  'canceled',
  'refund_requested',
  'refunded',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_PAYMENT_STATUSES = ['not_required', 'pending', 'paid', 'refund_pending', 'refunded'] as const;
export type OrderPaymentStatus = (typeof ORDER_PAYMENT_STATUSES)[number];

export const DELIVERY_METHODS = ['pickup', 'delivery'] as const;
export type DeliveryMethod = (typeof DELIVERY_METHODS)[number];

export const PAYMENT_STATUSES = ['pending', 'waiting_for_capture', 'succeeded', 'canceled', 'refunded', 'partially_refunded'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_PURPOSES = ['order', 'service'] as const;
export type PaymentPurpose = (typeof PAYMENT_PURPOSES)[number];

export const SERVICE_TYPES = [
  'bump', // поднятие в выдаче
  'highlight', // выделение цветом
  'premium', // премиум-размещение (отдельный блок выдачи)
  'listing_slot', // дополнительная публикация сверх бесплатного лимита
  'listing_package', // пакет публикаций
  'pro_subscription', // профессиональный аккаунт / подписка компании
  'analytics', // расширенная статистика
] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];

export const PROMOTION_TYPES = ['bump', 'highlight', 'premium'] as const;
export type PromotionType = (typeof PROMOTION_TYPES)[number];

export const PURCHASE_STATUSES = ['pending_payment', 'active', 'consumed', 'expired', 'canceled', 'refunded'] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];

export const COMPLAINT_TARGETS = ['listing', 'user', 'message', 'review'] as const;
export type ComplaintTarget = (typeof COMPLAINT_TARGETS)[number];

export const COMPLAINT_REASONS = [
  'fraud',
  'prohibited',
  'wrong_category',
  'duplicate',
  'spam',
  'offensive',
  'sold',
  'wrong_price',
  'other',
] as const;
export type ComplaintReason = (typeof COMPLAINT_REASONS)[number];

export const COMPLAINT_STATUSES = ['new', 'in_review', 'resolved', 'rejected'] as const;
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];

export const REVIEW_STATUSES = ['published', 'hidden'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const NOTIFICATION_CHANNELS = ['in_app', 'email', 'push', 'sms'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_GROUPS = ['messages', 'orders', 'listings', 'saved_searches', 'billing', 'marketing', 'security'] as const;
export type NotificationGroup = (typeof NOTIFICATION_GROUPS)[number];

export const REGION_TYPES = ['country', 'region', 'city', 'district'] as const;
export type RegionType = (typeof REGION_TYPES)[number];

export const ORG_MEMBER_ROLES = ['owner', 'manager'] as const;
export type OrgMemberRole = (typeof ORG_MEMBER_ROLES)[number];

export const SEARCH_SORTS = ['relevance', 'date_desc', 'price_asc', 'price_desc', 'distance'] as const;
export type SearchSort = (typeof SEARCH_SORTS)[number];

export const PLATFORMS = ['web', 'ios', 'android'] as const;
export type ClientPlatform = (typeof PLATFORMS)[number];
