import type {
  ComplaintReason,
  ComplaintStatus,
  ItemCondition,
  ListingStatus,
  OrderPaymentStatus,
  OrderStatus,
  PaymentStatus,
  PriceType,
  Role,
  Vertical,
} from './enums';

/**
 * Локализованные подписи. Сейчас — ru. Для новых языков добавляется словарь с тем же набором ключей
 * (ключи — машинные коды, тексты не участвуют в бизнес-логике).
 */
export const LABELS_RU = {
  listingStatus: {
    draft: 'Черновик',
    moderation: 'На проверке',
    active: 'Опубликовано',
    rejected: 'Отклонено',
    inactive: 'Снято с публикации',
    sold: 'Продано',
    expired: 'Срок истёк',
    archived: 'В архиве',
    blocked: 'Заблокировано',
    deleted: 'Удалено',
  } satisfies Record<ListingStatus, string>,
  orderStatus: {
    pending_payment: 'Ожидает оплаты',
    created: 'Ожидает подтверждения продавцом',
    confirmed: 'Подтверждён',
    shipped: 'Отправлен',
    delivered: 'Доставлен',
    completed: 'Завершён',
    canceled: 'Отменён',
    refund_requested: 'Запрошен возврат',
    refunded: 'Возврат выполнен',
  } satisfies Record<OrderStatus, string>,
  orderPaymentStatus: {
    not_required: 'Оплата при встрече',
    pending: 'Ожидает оплаты',
    paid: 'Оплачен',
    refund_pending: 'Возврат в обработке',
    refunded: 'Возвращён',
  } satisfies Record<OrderPaymentStatus, string>,
  paymentStatus: {
    pending: 'Ожидает оплаты',
    waiting_for_capture: 'Ожидает подтверждения',
    succeeded: 'Оплачен',
    canceled: 'Отменён',
    refunded: 'Возвращён',
    partially_refunded: 'Частичный возврат',
  } satisfies Record<PaymentStatus, string>,
  priceType: {
    fixed: 'Цена',
    negotiable: 'Цена, торг',
    free: 'Даром',
    on_request: 'Цена по запросу',
  } satisfies Record<PriceType, string>,
  condition: { new: 'Новое', used: 'Б/у' } satisfies Record<ItemCondition, string>,
  vertical: {
    goods: 'Товары',
    realty: 'Недвижимость',
    auto: 'Транспорт',
    jobs: 'Работа',
    services: 'Услуги',
  } satisfies Record<Vertical, string>,
  role: {
    super_admin: 'Суперадминистратор',
    admin: 'Администратор',
    moderator: 'Модератор',
    support: 'Поддержка',
    finance: 'Финансы',
  } satisfies Record<Role, string>,
  complaintReason: {
    fraud: 'Мошенничество',
    prohibited: 'Запрещённый товар или услуга',
    wrong_category: 'Неверная категория',
    duplicate: 'Дубликат',
    spam: 'Спам',
    offensive: 'Оскорбительное содержание',
    sold: 'Товар уже продан',
    wrong_price: 'Неверная цена',
    other: 'Другое',
  } satisfies Record<ComplaintReason, string>,
  complaintStatus: {
    new: 'Новая',
    in_review: 'На рассмотрении',
    resolved: 'Решена',
    rejected: 'Отклонена',
  } satisfies Record<ComplaintStatus, string>,
} as const;

export const LABELS = LABELS_RU;

export function pluralRu(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
