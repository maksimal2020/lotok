import type {
  AttributeType,
  ComplaintReason,
  ComplaintStatus,
  ComplaintTarget,
  ContactMethod,
  DeliveryMethod,
  ItemCondition,
  ListingStatus,
  MediaKind,
  MediaStatus,
  MessageType,
  NotificationChannel,
  NotificationGroup,
  OrderPaymentStatus,
  OrderStatus,
  PaymentPurpose,
  PaymentStatus,
  PriceType,
  PromotionType,
  PurchaseStatus,
  RegionType,
  Role,
  ServiceType,
  Vertical,
} from './enums';

/** Контракты ответов REST API v1. */

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ApiErrorBody {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
  requestId?: string;
}

export interface MediaUrls {
  thumb: string | null;
  medium: string | null;
  large: string | null;
}

export interface MediaItem {
  id: string;
  kind: MediaKind;
  status: MediaStatus;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  fileName: string | null;
  urls: MediaUrls;
  url: string | null;
}

export interface OrgMembership {
  id: string;
  name: string;
  role: 'owner' | 'manager';
}

export interface Me {
  id: string;
  email: string | null;
  emailVerified: boolean;
  phone: string | null;
  phoneVerified: boolean;
  displayName: string;
  about: string | null;
  avatarUrl: string | null;
  cityId: number | null;
  roles: Role[];
  permissions: string[];
  showPhone: boolean;
  ratingAvg: number | null;
  ratingCount: number;
  bonusBalance: number;
  createdAt: string;
  organizations: OrgMembership[];
  proUntil: string | null;
}

export interface AuthResponse {
  accessToken: string;
  /** Для мобильных клиентов. Веб получает refresh-токен в httpOnly cookie. */
  refreshToken?: string;
  expiresIn: number;
  user: Me;
}

export interface PublicUser {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  ratingAvg: number | null;
  ratingCount: number;
  createdAt: string;
  activeListings: number;
  isPro: boolean;
  organization: { id: string; name: string; verified: boolean } | null;
  lastSeenAt: string | null;
}

export interface OrganizationDto {
  id: string;
  name: string;
  inn: string;
  ogrn: string | null;
  legalAddress: string | null;
  description: string | null;
  website: string | null;
  logoUrl: string | null;
  cityId: number | null;
  verified: boolean;
  status: string;
  createdAt: string;
  activeListings: number;
  ratingAvg: number | null;
  ratingCount: number;
}

export interface CategoryDto {
  id: number;
  parentId: number | null;
  slug: string;
  name: string;
  vertical: Vertical;
  icon: string | null;
  sort: number;
  isActive: boolean;
  allowDelivery: boolean;
  allowVideo: boolean;
  maxPhotos: number;
  freeListingLimit: number | null;
  requiresManualModeration: boolean;
  children?: CategoryDto[];
}

export interface AttributeOptionDto {
  value: string;
  label: string;
  parentValue: string | null;
}

export interface CategoryAttributeDto {
  id: number;
  key: string;
  name: string;
  type: AttributeType;
  unit: string | null;
  minValue: number | null;
  maxValue: number | null;
  isRequired: boolean;
  isFilterable: boolean;
  showInCard: boolean;
  sort: number;
  dependsOn: string | null;
  options: AttributeOptionDto[];
}

export interface RegionDto {
  id: number;
  parentId: number | null;
  type: RegionType;
  name: string;
  slug: string;
  lat: number | null;
  lng: number | null;
}

export interface ListingCard {
  id: string;
  title: string;
  price: number | null;
  priceType: PriceType;
  currency: string;
  condition: ItemCondition | null;
  categoryId: number;
  cityId: number;
  cityName: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  photo: MediaUrls | null;
  photosCount: number;
  publishedAt: string | null;
  deliveryAvailable: boolean;
  isHighlighted: boolean;
  isPremium: boolean;
  isFavorite: boolean;
  status: ListingStatus;
  sellerId: string;
  distanceKm?: number | null;
}

export interface ListingAttributeDisplay {
  key: string;
  name: string;
  type: AttributeType;
  value: string | number | boolean | string[];
  display: string;
}

export interface ListingDetail extends ListingCard {
  description: string;
  attributes: ListingAttributeDisplay[];
  photos: MediaItem[];
  videoUrl: string | null;
  contactMethods: ContactMethod[];
  quantity: number;
  viewsCount: number;
  favoritesCount: number;
  seller: PublicUser;
  category: { id: number; name: string; slug: string; vertical: Vertical; path: { id: number; name: string; slug: string }[] };
  rejectionReason: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  isOwner: boolean;
  canBuy: boolean;
  organizationId: string | null;
  promotions: { type: PromotionType; endsAt: string }[];
}

export interface SearchFacetBucket {
  value: string;
  count: number;
}

export interface SearchResult {
  items: ListingCard[];
  premium: ListingCard[];
  total: number;
  page: number;
  limit: number;
  engine: 'opensearch' | 'postgres';
  facets: Record<string, SearchFacetBucket[]>;
}

export interface Suggestion {
  text: string;
  categoryId: number | null;
  categoryName: string | null;
}

export interface MapPoint {
  id: string;
  lat: number;
  lng: number;
  price: number | null;
  title: string;
}

export interface SavedSearchDto {
  id: string;
  name: string;
  query: Record<string, unknown>;
  notify: boolean;
  newCount: number;
  createdAt: string;
}

export interface ConversationDto {
  id: string;
  listing: { id: string; title: string; price: number | null; status: ListingStatus; photo: MediaUrls | null };
  counterpart: { id: string; displayName: string; avatarUrl: string | null; lastSeenAt: string | null };
  role: 'buyer' | 'seller';
  lastMessage: MessageDto | null;
  unreadCount: number;
  archived: boolean;
  blockedByMe: boolean;
  blockedMe: boolean;
  updatedAt: string;
}

export interface MessageDto {
  id: string;
  conversationId: string;
  senderId: string | null;
  type: MessageType;
  body: string;
  attachment: MediaItem | null;
  clientMessageId: string | null;
  createdAt: string;
  deliveredAt: string | null;
  readAt: string | null;
}

export interface NotificationDto {
  id: string;
  type: string;
  group: NotificationGroup;
  title: string;
  body: string;
  data: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPreferenceDto {
  group: NotificationGroup;
  channel: NotificationChannel;
  enabled: boolean;
}

export interface ReviewDto {
  id: string;
  rating: number;
  text: string;
  author: { id: string; displayName: string; avatarUrl: string | null };
  listing: { id: string; title: string } | null;
  role: 'buyer' | 'seller';
  createdAt: string;
  status: string;
}

export interface ComplaintDto {
  id: string;
  targetType: ComplaintTarget;
  targetId: string;
  reason: ComplaintReason;
  comment: string | null;
  status: ComplaintStatus;
  resolution: string | null;
  createdAt: string;
  reporter?: { id: string; displayName: string };
}

export interface OrderDto {
  id: string;
  number: string;
  status: OrderStatus;
  paymentStatus: OrderPaymentStatus;
  role: 'buyer' | 'seller' | 'staff';
  listing: { id: string; title: string; photo: MediaUrls | null };
  buyer: { id: string; displayName: string };
  seller: { id: string; displayName: string };
  quantity: number;
  itemPrice: number;
  deliveryPrice: number;
  total: number;
  currency: string;
  deliveryMethod: DeliveryMethod;
  deliveryProvider: string | null;
  deliveryAddress: Record<string, unknown> | null;
  trackingNumber: string | null;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
  availableActions: string[];
  canReview: boolean;
  history: { status: OrderStatus; at: string; actor: string; reason: string | null }[];
  payment: { id: string; status: PaymentStatus; confirmationUrl: string | null; testMode: boolean } | null;
  version: number;
}

export interface PaymentDto {
  id: string;
  purpose: PaymentPurpose;
  provider: string;
  amount: number;
  refundedAmount: number;
  currency: string;
  status: PaymentStatus;
  description: string;
  confirmationUrl: string | null;
  testMode: boolean;
  orderId: string | null;
  purchaseId: string | null;
  createdAt: string;
}

export interface PaidServiceDto {
  id: number;
  code: string;
  type: ServiceType;
  name: string;
  description: string;
  price: number;
  durationDays: number | null;
  quantity: number | null;
  categoryId: number | null;
  isActive: boolean;
  bonusAllowed: boolean;
  sort: number;
}

export interface PurchaseDto {
  id: string;
  service: { code: string; name: string; type: ServiceType };
  listingId: string | null;
  status: PurchaseStatus;
  price: number;
  paidWithBonus: number;
  quantityRemaining: number | null;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  payment: { id: string; status: PaymentStatus; confirmationUrl: string | null } | null;
}

export interface ListingStats {
  listingId: string;
  totals: { views: number; contacts: number; favorites: number };
  daily: { date: string; views: number; contacts: number; favorites: number }[];
  extended: boolean;
}

export interface DeliveryQuote {
  provider: string;
  providerName: string;
  price: number;
  daysMin: number;
  daysMax: number;
  testMode: boolean;
}

export interface AdPlacementDto {
  id: string;
  slot: string;
  title: string;
  imageUrl: string;
  targetUrl: string;
  advertiser: string;
  erid: string;
}
