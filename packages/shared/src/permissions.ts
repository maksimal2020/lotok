import type { Role } from './enums';

/**
 * RBAC: права администраторских ролей. Проверяется на backend (PermissionsGuard);
 * интерфейс админки использует ту же матрицу только для скрытия элементов.
 */
export const PERMISSIONS = [
  'dashboard.read',
  'users.read',
  'users.block',
  'users.update',
  'organizations.read',
  'organizations.manage',
  'listings.read',
  'listings.moderate',
  'listings.block',
  'complaints.read',
  'complaints.handle',
  'reviews.moderate',
  'categories.manage',
  'regions.manage',
  'tariffs.manage',
  'payments.read',
  'payments.refund',
  'orders.read',
  'orders.manage',
  'analytics.read',
  'audit.read',
  'roles.manage',
  'settings.manage',
  'ads.manage',
  'moderation.rules',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL = [...PERMISSIONS];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  super_admin: ALL,
  admin: ALL.filter((p) => p !== 'roles.manage'),
  moderator: [
    'dashboard.read',
    'users.read',
    'users.block',
    'listings.read',
    'listings.moderate',
    'listings.block',
    'complaints.read',
    'complaints.handle',
    'reviews.moderate',
    'moderation.rules',
  ],
  support: [
    'dashboard.read',
    'users.read',
    'organizations.read',
    'listings.read',
    'complaints.read',
    'complaints.handle',
    'orders.read',
    'orders.manage',
    'payments.read',
  ],
  finance: [
    'dashboard.read',
    'payments.read',
    'payments.refund',
    'orders.read',
    'tariffs.manage',
    'analytics.read',
    'organizations.read',
  ],
};

export function permissionsForRoles(roles: readonly Role[]): Set<Permission> {
  const set = new Set<Permission>();
  for (const r of roles) for (const p of ROLE_PERMISSIONS[r] ?? []) set.add(p);
  return set;
}

export function hasPermission(roles: readonly Role[], permission: Permission): boolean {
  return permissionsForRoles(roles).has(permission);
}

/** Какие роли вправе назначать роль target (только super_admin назначает admin/super_admin). */
export function canAssignRole(actorRoles: readonly Role[], target: Role): boolean {
  if (actorRoles.includes('super_admin')) return true;
  if (actorRoles.includes('admin')) return target === 'moderator' || target === 'support' || target === 'finance';
  return false;
}
