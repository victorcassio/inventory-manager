import { GENERIC_ERROR_MESSAGE } from '@/features/auth/lib/apiErrors'

/**
 * Every message the admin users area is willing to show, byte for byte.
 *
 * These are all authored by us, in `backend/src/modules/users/users.service.ts`
 * and `invitations.service.ts`, and each one tells the admin something they can
 * act on — which is why they are worth surfacing rather than collapsing into a
 * generic sentence. Matching is by equality for the same reason it is in
 * describeApiError: a substring test would let a tampered or buggy response
 * put arbitrary text inside our UI wearing our styling.
 */
const KNOWN_ADMIN_MESSAGES = new Set([
  'Já existe um usuário com este e-mail',
  'Usuário não encontrado',
  'Este usuário já ativou a conta',
  'Nenhum convite pendente para este usuário',
  'Reative o usuário antes de reenviar o convite',
  'Você não pode alterar o status da sua própria conta',
  'Você não pode alterar seu próprio perfil por este fluxo',
  'Não é permitido criar usuários administradores por este fluxo',
  'Não é permitido atribuir o perfil de administrador por este fluxo',
  'Gerenciamento de administradores não é permitido por este fluxo',
])

/** Shown when the server answered but said nothing we recognise. */
const BY_STATUS: Record<number, string> = {
  401: 'Sua sessão expirou. Entre novamente para continuar.',
  403: 'Você não tem permissão para esta ação.',
  404: 'Usuário não encontrado',
  429: 'Muitas tentativas em pouco tempo. Aguarde um instante e tente novamente.',
}

/**
 * Turns an API failure into something an administrator can read and act on,
 * without ever echoing text the server was not supposed to send.
 */
export function describeAdminError(error: unknown): string {
  const response = (error as { response?: { status?: number; data?: unknown } })?.response
  if (!response) return GENERIC_ERROR_MESSAGE

  const raw = (response.data as { message?: unknown })?.message
  const messages = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? [raw] : []

  const known = messages.find((message) => KNOWN_ADMIN_MESSAGES.has(message))
  if (known) return known

  return BY_STATUS[response.status ?? 0] ?? GENERIC_ERROR_MESSAGE
}
