import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import api, { setTokens, clearTokens } from '@/lib/api/client'

const PASSWORD = 'SenhaSecretaDoUsuario123'
const RESET_TOKEN = 'RESET-TOKEN-NUNCA-LOGAR'

/** Every string reachable from a value, at any depth. */
function deepStrings(value: unknown, seen = new Set<unknown>()): string[] {
  if (typeof value === 'string') return [value]
  if (!value || typeof value !== 'object') return []
  if (seen.has(value)) return []
  seen.add(value)
  return Object.getOwnPropertyNames(value).flatMap((key) => {
    try {
      return deepStrings((value as Record<string, unknown>)[key], seen)
    } catch {
      return []
    }
  })
}

function badRequest(config: InternalAxiosRequestConfig): Promise<AxiosResponse> {
  return Promise.reject(
    Object.assign(new Error('Request failed with status code 400'), {
      config,
      isAxiosError: true,
      response: {
        data: { message: 'A senha deve ter no mínimo 12 caracteres' },
        status: 400,
        statusText: 'Bad Request',
        headers: {},
        config,
      } as AxiosResponse,
    }),
  )
}

describe('request bodies never survive on a rejected error', () => {
  beforeEach(() => {
    clearTokens()
    api.defaults.adapter = ((config: InternalAxiosRequestConfig) => badRequest(config)) as never
  })

  afterEach(() => {
    api.defaults.adapter = undefined
    clearTokens()
    vi.restoreAllMocks()
  })

  it('drops the password and the single-use token from a failed reset', async () => {
    setTokens('at-1', 'rt-1')

    const error = await api
      .post('/auth/reset-password', {
        token: RESET_TOKEN,
        password: PASSWORD,
        passwordConfirmation: PASSWORD,
      })
      .catch((e: unknown) => e)

    const haystack = [
      ...deepStrings(error),
      JSON.stringify((error as { toJSON?: () => unknown })?.toJSON?.() ?? {}),
    ]

    for (const secret of [PASSWORD, RESET_TOKEN, 'at-1']) {
      expect(haystack.some((line) => line.includes(secret))).toBe(false)
    }
  })

  it('still gives the caller the server message it needs', async () => {
    // The scrubbing must not cost the UI the reason for the failure: hooks read
    // error.response.data.message, which is the RESPONSE body, not the request.
    const error = await api
      .post('/auth/change-password', { currentPassword: PASSWORD, newPassword: PASSWORD })
      .catch((e: unknown) => e)

    expect((error as { response?: { status?: number } }).response?.status).toBe(400)
    expect((error as { response?: { data?: { message?: string } } }).response?.data?.message).toBe(
      'A senha deve ter no mínimo 12 caracteres',
    )
  })
})
