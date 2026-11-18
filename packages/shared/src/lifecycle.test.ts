import { canTransitionListing, canTransitionOrder, LISTING_TRANSITIONS } from './lifecycle';
import { hasPermission, canAssignRole } from './permissions';
import { formatMoney, applyBasisPoints } from './money';
import { phone, createOrderSchema, password } from './schemas';
import { pluralRu } from './labels';
import { LISTING_STATUSES } from './enums';

describe('listing lifecycle', () => {
  it('allows owner to submit a draft', () => {
    expect(canTransitionListing('draft', 'moderation', 'owner')).toBe(true);
  });
  it('forbids owner from approving own listing', () => {
    expect(canTransitionListing('moderation', 'active', 'owner')).toBe(false);
  });
  it('forbids publishing a blocked listing by owner', () => {
    expect(canTransitionListing('blocked', 'moderation', 'owner')).toBe(false);
    expect(canTransitionListing('blocked', 'active', 'owner')).toBe(false);
  });
  it('allows moderator to unblock to inactive only', () => {
    expect(canTransitionListing('blocked', 'inactive', 'moderator')).toBe(true);
    expect(canTransitionListing('blocked', 'active', 'moderator')).toBe(false);
  });
  it('deleted is terminal', () => {
    for (const s of LISTING_STATUSES) {
      expect(canTransitionListing('deleted', s, 'owner')).toBe(false);
      expect(canTransitionListing('deleted', s, 'moderator')).toBe(false);
    }
  });
  it('has no duplicate transitions', () => {
    const keys = LISTING_TRANSITIONS.map((t) => `${t.from}>${t.to}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('order lifecycle', () => {
  it('only system confirms payment', () => {
    expect(canTransitionOrder('pending_payment', 'created', 'system')).toBe(true);
    expect(canTransitionOrder('pending_payment', 'created', 'buyer')).toBe(false);
  });
  it('seller confirms, buyer completes pickup', () => {
    expect(canTransitionOrder('created', 'confirmed', 'seller')).toBe(true);
    expect(canTransitionOrder('created', 'confirmed', 'buyer')).toBe(false);
    expect(canTransitionOrder('confirmed', 'completed', 'buyer')).toBe(true);
    expect(canTransitionOrder('confirmed', 'completed', 'seller')).toBe(false);
  });
  it('cannot cancel after shipping', () => {
    expect(canTransitionOrder('shipped', 'canceled', 'buyer')).toBe(false);
    expect(canTransitionOrder('shipped', 'canceled', 'seller')).toBe(false);
  });
});

describe('rbac', () => {
  it('moderator cannot refund', () => {
    expect(hasPermission(['moderator'], 'payments.refund')).toBe(false);
    expect(hasPermission(['finance'], 'payments.refund')).toBe(true);
  });
  it('only super admin manages roles', () => {
    expect(hasPermission(['admin'], 'roles.manage')).toBe(false);
    expect(hasPermission(['super_admin'], 'roles.manage')).toBe(true);
    expect(canAssignRole(['admin'], 'admin')).toBe(false);
    expect(canAssignRole(['admin'], 'moderator')).toBe(true);
  });
});

describe('money & validation', () => {
  it('formats rubles', () => {
    expect(formatMoney(150000).replace(/\s/g, ' ')).toBe('1 500 ₽');
    expect(applyBasisPoints(10001, 500)).toBe(500);
  });
  it('normalizes phone', () => {
    expect(phone.parse('8 (912) 345-67-89')).toBe('+79123456789');
    expect(() => phone.parse('+1234')).toThrow();
  });
  it('requires letters and digits in password', () => {
    expect(password.safeParse('abcdefgh').success).toBe(false);
    expect(password.safeParse('abcd1234').success).toBe(true);
  });
  it('requires address for delivery orders', () => {
    const r = createOrderSchema.safeParse({ listingId: '00000000-0000-4000-8000-000000000000', deliveryMethod: 'delivery' });
    expect(r.success).toBe(false);
  });
  it('plural ru', () => {
    expect(pluralRu(1, 'объявление', 'объявления', 'объявлений')).toBe('объявление');
    expect(pluralRu(3, 'объявление', 'объявления', 'объявлений')).toBe('объявления');
    expect(pluralRu(11, 'объявление', 'объявления', 'объявлений')).toBe('объявлений');
  });
});
