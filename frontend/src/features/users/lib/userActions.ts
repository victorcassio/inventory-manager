import type { AdminUser } from '@/types'

export interface ActionAvailability {
  available: boolean
  /** Why not, in words. Rendered for assistive technology when an action is
   *  shown but unavailable, so a disabled control is never unexplained. */
  reason?: string
}

const ADMIN_REASON = 'Contas de administrador não são gerenciadas por esta tela.'

/**
 * Which administrative actions apply to a row.
 *
 * These mirror the backend's own refusals — `users.service.ts` and
 * `invitations.service.ts` throw for every case below — and exist so the UI
 * does not offer an action the server will reject. They are UX, never the
 * enforcement point: the backend re-checks all of it, including the role of the
 * caller, which no client-side rule can be trusted to do.
 */
export function canEdit(user: AdminUser): ActionAvailability {
  if (user.role === 'admin') return { available: false, reason: ADMIN_REASON }
  return { available: true }
}

export function canChangeStatus(user: AdminUser, currentUserId?: string): ActionAvailability {
  if (user.role === 'admin') return { available: false, reason: ADMIN_REASON }
  if (user.id === currentUserId) {
    return {
      available: false,
      reason: 'Você não pode alterar o status da sua própria conta.',
    }
  }
  return { available: true }
}

export function canResendInvitation(user: AdminUser): ActionAvailability {
  if (user.role === 'admin') return { available: false, reason: ADMIN_REASON }
  if (user.passwordSetAt) {
    return { available: false, reason: 'Este usuário já definiu uma senha.' }
  }
  if (!user.isActive) {
    return { available: false, reason: 'Reative o usuário antes de reenviar o convite.' }
  }
  if (user.invitationStatus === 'accepted') {
    return { available: false, reason: 'Este usuário já ativou a conta.' }
  }
  return { available: true }
}

export function canRevokeInvitation(user: AdminUser): ActionAvailability {
  if (user.role === 'admin') return { available: false, reason: ADMIN_REASON }
  if (user.invitationStatus !== 'pending') {
    return { available: false, reason: 'Não há convite pendente para este usuário.' }
  }
  return { available: true }
}

/** True when the row has no administrative action at all. */
export function hasNoActions(user: AdminUser, currentUserId?: string): boolean {
  return (
    !canEdit(user).available &&
    !canChangeStatus(user, currentUserId).available &&
    !canResendInvitation(user).available &&
    !canRevokeInvitation(user).available
  )
}
