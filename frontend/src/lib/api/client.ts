import axios from 'axios'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

let accessToken: string | null = null
let refreshToken: string | null = null

export function setTokens(at: string, rt: string) {
  accessToken = at
  refreshToken = rt
}

export function clearTokens() {
  accessToken = null
  refreshToken = null
}

export function getAccessToken() { return accessToken }
export function getRefreshToken() { return refreshToken }

/**
 * What the 401-refresh cycle rejects with.
 *
 * Deliberately NOT an AxiosError: an axios error carries the whole request
 * config, which for the refresh call holds the refresh token in `config.data`
 * and the access token in `config.headers.Authorization`. Anything that later
 * serialises a rejected promise — an error reporter, a log shipper, a devtools
 * panel — would ship both. This carries a status and nothing else.
 */
export class RefreshFailedError extends Error {
  /**
   * HTTP status of the REFRESH call, when it made one and got a response.
   * Undefined when no refresh was attempted, when it never got that far, or
   * when it answered 200 with something unusable — never the status of the
   * request that triggered the cycle, which is a 401 by construction and would
   * say nothing.
   */
  readonly status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'RefreshFailedError'
    this.status = status
  }
}

const api: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:3000',
  headers: { 'Content-Type': 'application/json' },
  // Opt-in redaction (axios >= 1.16): AxiosError.toJSON() replaces these keys
  // at any depth. This covers the HEADERS only — see the interceptor below for
  // the request body, which it cannot reach.
  redact: ['authorization', 'cookie'],
})

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`
  return config
})

let isRefreshing = false
let failedQueue: Array<{ resolve: (value: string) => void; reject: (reason: unknown) => void }> = []

function processQueue(error: unknown, token: string | null) {
  failedQueue.forEach((p) => (error ? p.reject(error) : p.resolve(token!)))
  failedQueue = []
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config
    if (error.response?.status !== 401 || originalRequest._retry) return Promise.reject(error)

    if (isRefreshing) {
      // Marked before queueing: if this request 401s again after being retried
      // with the refreshed token, it must fail rather than start a second
      // refresh — otherwise a burst of 401s can loop.
      originalRequest._retry = true
      return new Promise<string>((resolve, reject) => {
        failedQueue.push({ resolve, reject })
      }).then((token) => {
        originalRequest.headers.Authorization = `Bearer ${token}`
        return api(originalRequest)
      })
    }

    originalRequest._retry = true
    isRefreshing = true

    // Captured OUTSIDE the try: the catch below compares against it to decide
    // whether this failure still belongs to the current session, so it has to
    // be in scope there too.
    const rt = refreshToken

    try {
      if (!rt) throw new RefreshFailedError('No refresh token')
      const { data } = await axios.post(
        `${import.meta.env.VITE_API_URL ?? 'http://localhost:3000'}/auth/refresh`,
        { refreshToken: rt },
      )
      // The session that started this refresh may be gone — logged out, or
      // replaced by a newer login that happened while the request was in
      // flight. Its result must not poison whatever session is current now.
      // Comparing the originating token is what makes this precise:
      // "is someone authenticated?" would be true for the newer session too.
      if (refreshToken !== rt) {
        // No status: the refresh itself answered 200. The 401 that started
        // the cycle is a constant here and would be misleading.
        const stale = new RefreshFailedError('Stale refresh response')
        processQueue(stale, null)
        return Promise.reject(stale)
      }

      // The server contract is TokensDto, but a 200 is not proof of it: a
      // captive portal, a proxy error page or a future backend change can all
      // return something else. Without this check setTokens() would store
      // `undefined` while the store — which does validate — keeps the old
      // values, leaving the two halves of the session permanently disagreeing.
      // Throwing routes the malformed case through the failure path instead.
      if (typeof data?.accessToken !== 'string' || typeof data?.refreshToken !== 'string') {
        throw new RefreshFailedError('Malformed refresh response')
      }

      const newAt: string = data.accessToken
      const newRt: string = data.refreshToken
      setTokens(newAt, newRt)
      processQueue(null, newAt)
      originalRequest.headers.Authorization = `Bearer ${newAt}`

      // sourceRefreshToken lets the store apply the same check independently:
      // this module and the store hold separate copies of the session.
      window.dispatchEvent(
        new CustomEvent('auth:tokens-refreshed', {
          detail: { accessToken: newAt, refreshToken: newRt, sourceRefreshToken: rt },
        }),
      )
      return api(originalRequest)
    } catch (refreshError) {
      const failure =
        refreshError instanceof RefreshFailedError
          ? refreshError
          : new RefreshFailedError(
              'Refresh failed',
              (refreshError as { response?: { status?: number } })?.response?.status,
            )
      processQueue(failure, null)

      // Same gate on the way down: only the session that started this refresh
      // may be ended by its failure. A late failure from a session the user has
      // already replaced is dropped, never propagated as a logout.
      if (refreshToken === rt) {
        clearTokens()
        window.dispatchEvent(
          new CustomEvent('auth:logout', {
            detail: {
              sourceRefreshToken: rt,
              // When rt is null this module holds no session at all, so there
              // is no token to correlate on. The store cannot verify that claim
              // against a token, so it is stated explicitly — otherwise a store
              // that still believes it is authenticated would keep an
              // unkillable zombie session over credentials nobody holds.
              reason: rt ? 'refresh-failed' : 'no-refresh-token',
            },
          }),
        )
      }
      return Promise.reject(failure)
    } finally {
      isRefreshing = false
    }
  },
)

// Registered after the refresh interceptor, so it sees every error on its way
// out to a caller. `redact` cannot help here: by the time an AxiosError exists
// its config.data is already a serialised JSON string, and key-based redaction
// cannot see inside a string. That string is the REQUEST body — which for the
// endpoints this branch adds is a plaintext password, or a single-use
// activation or reset token. Nothing in the app reads a request body off an
// error, so it is replaced rather than redacted key by key.
//
// This is what stands between those secrets and the first error reporter,
// log shipper or devtools panel that serialises a rejected promise.
api.interceptors.response.use(undefined, (error) => {
  const config = (error as { config?: { data?: unknown; headers?: Record<string, unknown> } } | null)
    ?.config
  if (config) {
    // The request body: a password, or a single-use activation/reset token.
    if (config.data !== undefined) config.data = '[REDACTED]'
    // The bearer token. `redact` only sanitises the toJSON() snapshot; the
    // error object itself keeps the real header, which any deep serialiser
    // walking own properties would still find.
    if (config.headers?.Authorization !== undefined) config.headers.Authorization = '[REDACTED]'
  }
  return Promise.reject(error)
})

export default api
