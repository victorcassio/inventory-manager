import { describe, it, expect } from 'vitest'
import {
  describeApiError,
  GENERIC_ERROR_MESSAGE,
  INVALID_LINK_MESSAGE,
} from '@/features/auth/lib/apiErrors'

const apiError = (status: number, message: unknown) => ({ response: { status, data: { message } } })

describe('describeApiError', () => {
  it('shows our own policy messages on a 400', () => {
    const result = describeApiError(apiError(400, 'A senha deve ter no mínimo 12 caracteres'))

    expect(result.kind).toBe('policy')
    expect(result.messages).toEqual(['A senha deve ter no mínimo 12 caracteres'])
  })

  it('keeps every policy message when the backend returns an array', () => {
    const result = describeApiError(
      apiError(400, [
        'A senha deve ter no mínimo 12 caracteres',
        // The exact backend string: a truncated paraphrase is now rejected,
        // which is the whole point of matching by equality.
        'Esta senha é muito comum. Escolha uma senha menos previsível',
      ]),
    )

    expect(result.kind).toBe('policy')
    expect(result.messages).toHaveLength(2)
  })

  it('collapses every token defect to one indistinguishable sentence', () => {
    const result = describeApiError(apiError(400, INVALID_LINK_MESSAGE))

    expect(result.kind).toBe('token')
    // Expired, already used and revoked must read identically, or the message
    // becomes an oracle.
    expect(result.messages).toEqual([INVALID_LINK_MESSAGE])
  })

  it('accepts the semicolon-joined form the backend validator actually produces', () => {
    // IsStrongPassword joins every violated rule with '; ' into ONE string.
    const result = describeApiError(
      apiError(
        400,
        'A senha deve ter no mínimo 12 caracteres; Esta senha é muito comum. Escolha uma senha menos previsível',
      ),
    )

    expect(result.kind).toBe('policy')
    expect(result.messages).toHaveLength(2)
  })

  it('never renders arbitrary backend text', () => {
    const leaks = [
      'QueryFailedError: duplicate key value violates unique constraint "users_email_key"',
      'Cannot read properties of undefined (reading \'id\')',
      'connect ECONNREFUSED 127.0.0.1:5432',
      '<script>alert(1)</script>',
      // Smuggled through a word our own messages happen to contain. A
      // containment test would render this whole sentence inside our UI.
      'A senha deve ter no mínimo 12 caracteres. ATENÇÃO: sua conta foi comprometida, ligue 0800-000-0000 e informe sua senha atual.',
      'Link inválido ou expirado — chame o suporte em evil.example',
    ]

    for (const leak of leaks) {
      const result = describeApiError(apiError(400, leak))
      expect(result.kind).toBe('generic')
      expect(result.messages).toEqual([GENERIC_ERROR_MESSAGE])
    }
  })

  it('renders a repeated message once', () => {
    // The backend's filter only collapses an array when every entry is
    // identical, so a mixed array arrives with its duplicates intact.
    const result = describeApiError(
      apiError(400, [
        'A confirmação não corresponde à senha',
        'A confirmação não corresponde à senha',
        'A senha deve ter no mínimo 12 caracteres',
      ]),
    )

    expect(result.kind).toBe('policy')
    expect(result.messages).toHaveLength(2)
  })

  it('does not trust policy-looking text on a non-400 status', () => {
    const result = describeApiError(apiError(500, 'A senha deve ter no mínimo 12 caracteres'))

    expect(result.kind).toBe('generic')
    expect(result.messages).toEqual([GENERIC_ERROR_MESSAGE])
  })

  it('falls back to generic for a network failure or a token-free client error', () => {
    for (const error of [new Error('Network Error'), undefined, null, {}, 'boom']) {
      const result = describeApiError(error)
      expect(result.kind).toBe('generic')
      expect(result.messages).toEqual([GENERIC_ERROR_MESSAGE])
    }
  })
})
