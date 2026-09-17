import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '@/schemas/password.schema'

export const INVALID_LINK_MESSAGE = 'Link inválido ou expirado'
export const GENERIC_ERROR_MESSAGE =
  'Não foi possível processar a solicitação agora. Tente novamente.'

type ErrorKind = 'policy' | 'token' | 'generic'

/**
 * The complete set of password messages this application is willing to put on
 * screen, byte for byte.
 *
 * Matching is by equality, never by containment: a substring test would render
 * anything that merely happens to contain a common Portuguese word like
 * "caracteres", verbatim and unbounded. A tampered or compromised API could use
 * that to place its own text — "ligue para 0800… e informe sua senha" — inside
 * our own UI, wearing our styling. Equality means the worst a hostile body can
 * achieve is the generic retry message.
 *
 * These mirror `backend/src/modules/hashing/password-policy.ts` and the
 * BadRequestExceptions in `backend/src/modules/auth/password.service.ts`.
 */
const KNOWN_POLICY_MESSAGES = new Set([
  `A senha deve ter no mínimo ${PASSWORD_MIN_LENGTH} caracteres`,
  `A senha deve ter no máximo ${PASSWORD_MAX_LENGTH} caracteres`,
  'Esta senha é muito comum. Escolha uma senha menos previsível',
  'A senha deve ser um texto',
  'A confirmação não corresponde à senha',
  'A nova senha deve ser diferente da senha atual',
  'Senha atual incorreta',
  // Not password policy, but one of ours and safe to show: the forgot-password
  // endpoint returns it for a malformed address.
  'E-mail inválido',
])

/**
 * The backend's IsStrongPassword validator joins every violated rule into one
 * string with '; ', so a single message can legitimately carry several known
 * sentences. Split, and accept only if every part is one of ours.
 */
function knownPolicyParts(message: string): string[] | null {
  const parts = message.split('; ').map((part) => part.trim())
  // All or nothing, deliberately. If the backend adds a rule this file does not
  // know, the whole message degrades to the generic sentence rather than
  // rendering the unknown part — fail closed on untrusted text. The cost is
  // that a routine backend change silently coarsens every password error until
  // the new string is added here.
  return parts.every((part) => KNOWN_POLICY_MESSAGES.has(part)) ? parts : null
}

/**
 * Classifies an API failure into exactly one of three presentations.
 *
 * Backend text is never passed through on trust. A server exception, a stack
 * trace leaking through a misconfigured filter, a validation message naming an
 * internal field — none of it reaches the screen. Every token defect collapses
 * to one fixed sentence, so an expired link is indistinguishable from a used or
 * a revoked one, and everything unrecognised becomes a retry message.
 */
export function describeApiError(error: unknown): { kind: ErrorKind; messages: string[] } {
  const response = (error as { response?: { status?: number; data?: unknown } })?.response

  // No response at all: a network failure, or one of the auth client's own
  // token-free errors. Nothing to classify.
  if (!response) return { kind: 'generic', messages: [GENERIC_ERROR_MESSAGE] }

  const raw = (response.data as { message?: unknown })?.message
  const messages = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? [raw] : []

  if (messages.some((message) => message === INVALID_LINK_MESSAGE)) {
    return { kind: 'token', messages: [INVALID_LINK_MESSAGE] }
  }

  // Deduped here rather than on the raw array: the backend's filter collapses
  // an array only when every entry is identical, so a mixed array arrives with
  // its duplicates intact and would otherwise render the same sentence twice.
  const policy = [...new Set(messages.flatMap((message) => knownPolicyParts(message) ?? []))]

  if (response.status === 400 && policy.length > 0) {
    return { kind: 'policy', messages: policy }
  }

  return { kind: 'generic', messages: [GENERIC_ERROR_MESSAGE] }
}
