import type { UserRole } from '@/types'

export const PERMISSIONS = {
  customers: {
    view: ['admin', 'attendant', 'financial'] as UserRole[],
    manage: ['admin', 'attendant'] as UserRole[],
    delete: ['admin'] as UserRole[],
  },
  inventory: {
    view: ['admin', 'attendant', 'financial'] as UserRole[],
    manage: ['admin'] as UserRole[],
  },
  rentals: {
    view: ['admin', 'attendant', 'financial'] as UserRole[],
    manage: ['admin', 'attendant'] as UserRole[],
    cancel: ['admin'] as UserRole[],
  },
  returns: {
    view: ['admin', 'attendant', 'financial'] as UserRole[],
    manage: ['admin', 'attendant'] as UserRole[],
  },
  payments: {
    view: ['admin', 'attendant', 'financial'] as UserRole[],
    manage: ['admin', 'financial'] as UserRole[],
  },
  financial: {
    view: ['admin', 'financial'] as UserRole[],
    manage: ['admin', 'financial'] as UserRole[],
  },
  documents: {
    view: ['admin', 'attendant', 'financial'] as UserRole[],
    generateContract: ['admin', 'attendant'] as UserRole[],
    generateReceipt: ['admin', 'financial'] as UserRole[],
    generateProof: ['admin', 'attendant'] as UserRole[],
  },
  calendar: {
    view: ['admin', 'attendant'] as UserRole[],
  },
} as const

export function hasPermission(role: UserRole, resource: keyof typeof PERMISSIONS, action: string): boolean {
  const resourcePerms = PERMISSIONS[resource] as Record<string, UserRole[]>
  return resourcePerms[action]?.includes(role) ?? false
}

export function canAccess(role: UserRole, resource: keyof typeof PERMISSIONS): boolean {
  return hasPermission(role, resource, 'view')
}
