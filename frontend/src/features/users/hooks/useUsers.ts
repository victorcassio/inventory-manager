import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { usersApi, type ListUsersParams } from '@/lib/api/users.api'
import { describeAdminError } from '../lib/adminErrors'

export const userKeys = {
  all: ['users'] as const,
  lists: () => [...userKeys.all, 'list'] as const,
  list: (params?: object) => [...userKeys.lists(), params] as const,
  details: () => [...userKeys.all, 'detail'] as const,
  detail: (id: string) => [...userKeys.details(), id] as const,
}

export const CREATED_MESSAGE =
  'Usuário criado. Um convite foi enviado para que ele valide o e-mail e defina sua senha.'
export const CREATED_MAIL_FAILED_MESSAGE =
  'Usuário criado, mas o convite não pôde ser enviado. Use "Reenviar convite" na lista.'
export const RESENT_MESSAGE = 'Convite reenviado.'
export const RESEND_MAIL_FAILED_MESSAGE =
  'O convite não pôde ser enviado agora. Tente reenviar em instantes.'

/**
 * Every mutation in this area shares one scope, so React Query runs them one at
 * a time. Two actions on the same row — a status change and a revoke, say —
 * can otherwise resolve out of order, and the slower, older response would be
 * the one whose toast and invalidation land last. Serialising is cheap here:
 * these are single-row administrative actions, not a hot path.
 */
const ADMIN_SCOPE = { id: 'users-admin' } as const

export function useUsersList(params?: ListUsersParams) {
  return useQuery({
    queryKey: userKeys.list(params),
    queryFn: () => usersApi.list(params),
  })
}

export function useUser(id: string) {
  return useQuery({
    queryKey: userKeys.detail(id),
    queryFn: () => usersApi.getById(id),
    enabled: !!id,
  })
}

/**
 * Invalidates only what this area owns. Scoped to `userKeys.all`, so an admin
 * action never refetches rentals, payments or the dashboard — and because
 * invalidation refetches each active query under its OWN key, the list comes
 * back on the same page with the same filters.
 */
function useInvalidateUsers() {
  const queryClient = useQueryClient()
  return (id?: string) => {
    queryClient.invalidateQueries({ queryKey: userKeys.lists() })
    if (id) queryClient.invalidateQueries({ queryKey: userKeys.detail(id) })
  }
}

export function useCreateUser() {
  const invalidate = useInvalidateUsers()

  return useMutation({
    scope: ADMIN_SCOPE,
    mutationFn: usersApi.create,
    onSuccess: (result) => {
      invalidate(result.user.id)
      // Never claim delivery the API did not confirm. invitationEmailSent is
      // the server telling us whether the message actually went out; saying
      // "convite enviado" on false would leave an admin waiting for an e-mail
      // that was never sent, with no idea a resend is needed.
      if (result.invitationEmailSent) toast.success(CREATED_MESSAGE)
      else toast.warning(CREATED_MAIL_FAILED_MESSAGE)
    },
    onError: (error) => toast.error(describeAdminError(error)),
  })
}

export function useUpdateUser() {
  const invalidate = useInvalidateUsers()

  return useMutation({
    scope: ADMIN_SCOPE,
    mutationFn: ({
      id,
      data,
    }: {
      id: string
      data: { name?: string; role?: 'attendant' | 'financial' }
    }) => usersApi.update(id, data),
    onSuccess: (user) => {
      invalidate(user.id)
      toast.success('Usuário atualizado.')
    },
    onError: (error) => toast.error(describeAdminError(error)),
  })
}

export function useUpdateUserStatus() {
  const invalidate = useInvalidateUsers()

  return useMutation({
    scope: ADMIN_SCOPE,
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      usersApi.updateStatus(id, isActive),
    onSuccess: (user) => {
      invalidate(user.id)
      toast.success(user.isActive ? 'Usuário ativado.' : 'Usuário desativado.')
    },
    onError: (error) => toast.error(describeAdminError(error)),
  })
}

export function useResendInvitation() {
  const invalidate = useInvalidateUsers()

  return useMutation({
    scope: ADMIN_SCOPE,
    mutationFn: (id: string) => usersApi.resendInvitation(id),
    onSuccess: (result) => {
      invalidate(result.user.id)
      if (result.invitationEmailSent) toast.success(RESENT_MESSAGE)
      else toast.warning(RESEND_MAIL_FAILED_MESSAGE)
    },
    onError: (error) => toast.error(describeAdminError(error)),
  })
}

export function useRevokeInvitation() {
  const invalidate = useInvalidateUsers()

  return useMutation({
    scope: ADMIN_SCOPE,
    mutationFn: (id: string) => usersApi.revokeInvitation(id),
    onSuccess: (_result, id) => {
      invalidate(id)
      toast.success('Convite revogado.')
    },
    onError: (error) => toast.error(describeAdminError(error)),
  })
}
