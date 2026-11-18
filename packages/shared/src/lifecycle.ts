import type { ListingStatus, OrderStatus } from './enums';

export type LifecycleActor = 'owner' | 'moderator' | 'system';

export interface Transition<S extends string, A extends string = LifecycleActor> {
  from: S;
  to: S;
  actors: A[];
  action: string;
}

/**
 * Жизненный цикл объявления. Любой переход, не описанный здесь, запрещён.
 * action — машинное имя операции (используется в истории статусов и API).
 */
export const LISTING_TRANSITIONS: Transition<ListingStatus>[] = [
  { from: 'draft', to: 'moderation', actors: ['owner'], action: 'submit' },
  { from: 'rejected', to: 'moderation', actors: ['owner'], action: 'submit' },
  { from: 'moderation', to: 'active', actors: ['moderator', 'system'], action: 'approve' },
  { from: 'moderation', to: 'rejected', actors: ['moderator', 'system'], action: 'reject' },
  { from: 'active', to: 'moderation', actors: ['owner', 'system'], action: 'remoderate' },
  { from: 'active', to: 'inactive', actors: ['owner'], action: 'unpublish' },
  { from: 'active', to: 'sold', actors: ['owner', 'system'], action: 'mark_sold' },
  { from: 'active', to: 'expired', actors: ['system'], action: 'expire' },
  { from: 'inactive', to: 'moderation', actors: ['owner'], action: 'republish' },
  { from: 'expired', to: 'moderation', actors: ['owner'], action: 'republish' },
  { from: 'sold', to: 'moderation', actors: ['owner'], action: 'republish' },
  { from: 'archived', to: 'moderation', actors: ['owner'], action: 'republish' },
  { from: 'inactive', to: 'archived', actors: ['owner'], action: 'archive' },
  { from: 'expired', to: 'archived', actors: ['owner', 'system'], action: 'archive' },
  { from: 'sold', to: 'archived', actors: ['owner', 'system'], action: 'archive' },
  { from: 'rejected', to: 'archived', actors: ['owner'], action: 'archive' },
  { from: 'moderation', to: 'blocked', actors: ['moderator'], action: 'block' },
  { from: 'active', to: 'blocked', actors: ['moderator'], action: 'block' },
  { from: 'inactive', to: 'blocked', actors: ['moderator'], action: 'block' },
  { from: 'rejected', to: 'blocked', actors: ['moderator'], action: 'block' },
  { from: 'blocked', to: 'inactive', actors: ['moderator'], action: 'unblock' },
  ...(['draft', 'rejected', 'inactive', 'sold', 'expired', 'archived'] as const).map((from) => ({
    from,
    to: 'deleted' as const,
    actors: ['owner' as const],
    action: 'delete',
  })),
];

export function findListingTransition(from: ListingStatus, to: ListingStatus, actor: LifecycleActor) {
  return LISTING_TRANSITIONS.find((t) => t.from === from && t.to === to && t.actors.includes(actor)) ?? null;
}

export function canTransitionListing(from: ListingStatus, to: ListingStatus, actor: LifecycleActor): boolean {
  return findListingTransition(from, to, actor) !== null;
}

/** Статусы, в которых объявление доступно публично. */
export const PUBLIC_LISTING_STATUSES: ListingStatus[] = ['active'];
/** Статусы, в которых владелец может редактировать содержимое. */
export const EDITABLE_LISTING_STATUSES: ListingStatus[] = ['draft', 'rejected', 'active', 'inactive', 'expired', 'sold', 'archived'];

export type OrderActor = 'buyer' | 'seller' | 'system' | 'support';

/** Жизненный цикл заказа. */
export const ORDER_TRANSITIONS: Transition<OrderStatus, OrderActor>[] = [
  { from: 'pending_payment', to: 'created', actors: ['system'], action: 'payment_succeeded' },
  { from: 'pending_payment', to: 'canceled', actors: ['buyer', 'system', 'support'], action: 'cancel' },
  { from: 'created', to: 'confirmed', actors: ['seller'], action: 'confirm' },
  { from: 'created', to: 'canceled', actors: ['buyer', 'seller', 'system', 'support'], action: 'cancel' },
  { from: 'confirmed', to: 'shipped', actors: ['seller'], action: 'ship' },
  { from: 'confirmed', to: 'completed', actors: ['buyer', 'support'], action: 'complete' },
  { from: 'confirmed', to: 'canceled', actors: ['buyer', 'seller', 'support'], action: 'cancel' },
  { from: 'shipped', to: 'delivered', actors: ['seller', 'system', 'support'], action: 'deliver' },
  { from: 'delivered', to: 'completed', actors: ['buyer', 'system', 'support'], action: 'complete' },
  { from: 'delivered', to: 'refund_requested', actors: ['buyer'], action: 'request_refund' },
  { from: 'refund_requested', to: 'refunded', actors: ['seller', 'support'], action: 'approve_refund' },
  { from: 'refund_requested', to: 'completed', actors: ['support'], action: 'reject_refund' },
];

export function findOrderTransition(from: OrderStatus, to: OrderStatus, actor: OrderActor) {
  return ORDER_TRANSITIONS.find((t) => t.from === from && t.to === to && t.actors.includes(actor)) ?? null;
}

export function canTransitionOrder(from: OrderStatus, to: OrderStatus, actor: OrderActor): boolean {
  return findOrderTransition(from, to, actor) !== null;
}

export const TERMINAL_ORDER_STATUSES: OrderStatus[] = ['completed', 'canceled', 'refunded'];
