import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { StrictMode } from 'react'
import { act, render } from '@testing-library/react'
import axios, { AxiosError } from 'axios'
import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { useAuthStore } from '@/stores/auth.store'
import api, {
  getAccessToken,
  getRefreshToken,
  setTokens,
  clearTokens,
  RefreshFailedError,
} from '@/lib/api/client'
import { Providers } from '@/app/providers'

const USER = {
  id: 'u1',
  name: 'Maria',
  email: 'maria@test.com',
  role: 'attendant' as const,
  isActive: true,
  createdAt: '2026-01-01',
  emailVerifiedAt: null,
  passwordSetAt: null,
}

/** A refresh that succeeded, announced by the axios client. */
function dispatchRefreshed(detail: {
  accessToken: string
  refreshToken: string
  sourceRefreshToken: string
}) {
  window.dispatchEvent(new CustomEvent('auth:tokens-refreshed', { detail }))
}

/** A refresh that failed, announced by the axios client. */
function dispatchRefreshFailed(detail: { sourceRefreshToken: string }) {
  window.dispatchEvent(new CustomEvent('auth:logout', { detail }))
}

const store = () => useAuthStore.getState()

function resetAll() {
  localStorage.clear()
  clearTokens()
  store().clearAuth()
  api.defaults.adapter = undefined
  vi.restoreAllMocks()
}

// ---------------------------------------------------------------------------
// The store listener: which results a session is allowed to accept.
// ---------------------------------------------------------------------------

describe('refresh race — store listener gating', () => {
  beforeEach(() => {
    resetAll()
    render(
      <Providers>
        <div />
      </Providers>,
    )
  })

  afterEach(resetAll)

  it('updates the tokens of the session that started the refresh', () => {
    store().setAuth(USER, 'at-1', 'rt-1')

    dispatchRefreshed({ accessToken: 'at-2', refreshToken: 'rt-2', sourceRefreshToken: 'rt-1' })

    expect(store().accessToken).toBe('at-2')
    expect(store().refreshToken).toBe('rt-2')
    expect(store().isAuthenticated).toBe(true)
  })

  it('does not restore a session that logged out while the refresh was in flight', () => {
    store().setAuth(USER, 'at-1', 'rt-1')
    store().clearAuth()

    dispatchRefreshed({ accessToken: 'at-2', refreshToken: 'rt-2', sourceRefreshToken: 'rt-1' })

    expect(store().isAuthenticated).toBe(false)
    expect(store().accessToken).toBeNull()
    expect(store().user).toBeNull()
  })

  it('does not let session A overwrite the newer session B', () => {
    store().setAuth(USER, 'at-A', 'rt-A')
    store().clearAuth()
    store().setAuth(USER, 'at-B', 'rt-B')

    // A's refresh, started before the re-login, finally resolves.
    dispatchRefreshed({ accessToken: 'at-A2', refreshToken: 'rt-A2', sourceRefreshToken: 'rt-A' })

    expect(store().accessToken).toBe('at-B')
    expect(store().refreshToken).toBe('rt-B')
  })

  it('clears authentication when the refresh of the CURRENT session fails', () => {
    store().setAuth(USER, 'at-1', 'rt-1')

    dispatchRefreshFailed({ sourceRefreshToken: 'rt-1' })

    expect(store().isAuthenticated).toBe(false)
    expect(store().user).toBeNull()
  })

  it('does not log out session B when session A\'s refresh fails late', () => {
    store().setAuth(USER, 'at-A', 'rt-A')
    store().clearAuth()
    store().setAuth(USER, 'at-B', 'rt-B')

    // A's refresh finally fails — long after B logged in.
    dispatchRefreshFailed({ sourceRefreshToken: 'rt-A' })

    expect(store().isAuthenticated).toBe(true)
    expect(store().accessToken).toBe('at-B')
    expect(store().refreshToken).toBe('rt-B')
  })

  it('ignores a failure that names no originating session', () => {
    store().setAuth(USER, 'at-1', 'rt-1')

    window.dispatchEvent(new Event('auth:logout'))

    // The client always names the session. An event that does not is not ours,
    // and must not be able to end a session.
    expect(store().isAuthenticated).toBe(true)
  })

  it('clearAuth invalidates every in-flight refresh result, axios state included', () => {
    store().setAuth(USER, 'at-1', 'rt-1')
    setTokens('at-1', 'rt-1')

    store().clearAuth()
    dispatchRefreshed({ accessToken: 'at-2', refreshToken: 'rt-2', sourceRefreshToken: 'rt-1' })

    expect(store().isAuthenticated).toBe(false)
    expect(getAccessToken()).toBeNull()
    expect(getRefreshToken()).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Listener lifecycle.
// ---------------------------------------------------------------------------

describe('refresh race — listener lifecycle', () => {
  beforeEach(resetAll)
  afterEach(resetAll)

  it('registers one net listener under StrictMode double mounting', () => {
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')

    render(
      <StrictMode>
        <Providers>
          <div />
        </Providers>
      </StrictMode>,
    )

    const added = add.mock.calls.filter(([type]) => type === 'auth:tokens-refreshed')
    const removed = remove.mock.calls.filter(([type]) => type === 'auth:tokens-refreshed')
    // StrictMode mounts, unmounts and remounts: two registrations, one cleanup,
    // one live listener. A missing cleanup would leave two.
    expect(added).toHaveLength(2)
    expect(removed).toHaveLength(1)
  })

  it('applies a refresh exactly once under StrictMode double mounting', () => {
    render(
      <StrictMode>
        <Providers>
          <div />
        </Providers>
      </StrictMode>,
    )
    store().setAuth(USER, 'at-1', 'rt-1')

    let stateChanges = 0
    const unsubscribe = useAuthStore.subscribe(() => {
      stateChanges++
    })

    dispatchRefreshed({ accessToken: 'at-2', refreshToken: 'rt-2', sourceRefreshToken: 'rt-1' })
    unsubscribe()

    expect(store().accessToken).toBe('at-2')
    // A duplicated listener would run updateTokens twice. The second run is
    // rejected by the source-token guard, so the damage is bounded either way —
    // but a single state change is what a correctly cleaned-up mount produces.
    expect(stateChanges).toBe(1)
  })

  it('stops listening once unmounted, so remounts cannot stack listeners', () => {
    const { unmount } = render(
      <Providers>
        <div />
      </Providers>,
    )
    store().setAuth(USER, 'at-1', 'rt-1')

    unmount()
    dispatchRefreshed({ accessToken: 'at-2', refreshToken: 'rt-2', sourceRefreshToken: 'rt-1' })

    expect(store().accessToken).toBe('at-1')
  })
})

// ---------------------------------------------------------------------------
// The axios interceptor: one refresh per burst, and a gated failure path.
// ---------------------------------------------------------------------------

function ok(config: InternalAxiosRequestConfig, data: unknown = { ok: true }): Promise<AxiosResponse> {
  return Promise.resolve({ data, status: 200, statusText: 'OK', headers: {}, config } as AxiosResponse)
}

function unauthorized(config: InternalAxiosRequestConfig): Promise<AxiosResponse> {
  const error = Object.assign(new Error('Request failed with status code 401'), {
    config,
    isAxiosError: true,
    response: {
      data: { message: 'Não autorizado' },
      status: 401,
      statusText: 'Unauthorized',
      headers: {},
      config,
    } as AxiosResponse,
  })
  return Promise.reject(error)
}

describe('refresh race — axios interceptor', () => {
  beforeEach(resetAll)
  afterEach(resetAll)

  it('shares one refresh between simultaneous 401s and retries each with the new token', async () => {
    setTokens('at-1', 'rt-1')
    const seen: string[] = []

    api.defaults.adapter = (async (config: InternalAxiosRequestConfig) => {
      const auth = String(config.headers?.Authorization ?? '')
      seen.push(auth)
      // Only the refreshed token is accepted.
      return auth === 'Bearer at-2' ? ok(config, { url: config.url }) : unauthorized(config)
    }) as never

    const refresh = vi
      .spyOn(axios, 'post')
      .mockResolvedValue({ data: { accessToken: 'at-2', refreshToken: 'rt-2' } } as never)

    const [a, b] = await Promise.all([api.get('/alpha'), api.get('/beta')])

    // One refresh for the whole burst.
    expect(refresh).toHaveBeenCalledTimes(1)
    // Both waiters got the NEW token, not the stale one and not each other's.
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    expect(seen.filter((h) => h === 'Bearer at-2')).toHaveLength(2)
    expect(getAccessToken()).toBe('at-2')
  })

  it('does not start a second refresh when a queued retry 401s again', async () => {
    setTokens('at-1', 'rt-1')
    const post = vi
      .spyOn(axios, 'post')
      .mockResolvedValue({ data: { accessToken: 'at-2', refreshToken: 'rt-2' } } as never)
    // Nothing is ever accepted, so every retry 401s too.
    api.defaults.adapter = ((config: InternalAxiosRequestConfig) =>
      unauthorized(config)) as never

    const results = await Promise.allSettled([
      api.get('/alpha'),
      api.get('/beta'),
      api.get('/gama'),
    ])

    expect(results.every((r) => r.status === 'rejected')).toBe(true)
    // Without _retry set before queueing, each queued request's retry starts
    // its own refresh: three calls instead of one, i.e. a 401 storm amplified
    // into N refreshes against a rate-limited endpoint.
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('does not clear the tokens of a session that replaced the one whose refresh failed', async () => {
    setTokens('at-A', 'rt-A')

    api.defaults.adapter = ((config: InternalAxiosRequestConfig) =>
      unauthorized(config)) as never

    vi.spyOn(axios, 'post').mockImplementation(async () => {
      // While A's refresh was in flight, the user logged in again as B.
      setTokens('at-B', 'rt-B')
      throw new Error('refresh rejected')
    })

    const error = await api.get('/alpha').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(RefreshFailedError)
    expect((error as RefreshFailedError).message).toBe('Refresh failed')

    // B's tokens survive A's failure.
    expect(getAccessToken()).toBe('at-B')
    expect(getRefreshToken()).toBe('rt-B')
  })

  it('clears the tokens when the failing refresh is still the current session', async () => {
    setTokens('at-1', 'rt-1')

    api.defaults.adapter = ((config: InternalAxiosRequestConfig) =>
      unauthorized(config)) as never
    vi.spyOn(axios, 'post').mockRejectedValue(new Error('refresh rejected'))

    await expect(api.get('/alpha')).rejects.toThrow('Refresh failed')

    expect(getAccessToken()).toBeNull()
    expect(getRefreshToken()).toBeNull()
  })

  it('discards a refresh result whose session was replaced mid-flight', async () => {
    setTokens('at-A', 'rt-A')

    api.defaults.adapter = ((config: InternalAxiosRequestConfig) =>
      unauthorized(config)) as never

    vi.spyOn(axios, 'post').mockImplementation(async () => {
      setTokens('at-B', 'rt-B')
      return { data: { accessToken: 'at-A2', refreshToken: 'rt-A2' } } as never
    })

    // The stale branch, not the failure branch: the refresh itself succeeded.
    const staleError = await api.get('/alpha').catch((e: unknown) => e)
    expect(staleError).toBeInstanceOf(RefreshFailedError)
    expect((staleError as RefreshFailedError).message).toBe('Stale refresh response')
    // No status: the refresh answered 200 and it was the SESSION that went
    // stale. Reporting the triggering request's 401 here would give the field
    // two meanings on two paths.
    expect((staleError as RefreshFailedError).status).toBeUndefined()

    // A's result is thrown away; B is untouched.
    expect(getAccessToken()).toBe('at-B')
    expect(getRefreshToken()).toBe('rt-B')
  })
})

// ---------------------------------------------------------------------------
// Secrets must not escape into anything a human or a log aggregator reads.
// ---------------------------------------------------------------------------

/**
 * The error axios really produces when /auth/refresh fails: the refresh token
 * is in the serialised request body and the access token is in the request
 * headers. A plain `new Error()` would make every assertion below pass without
 * testing anything.
 */
function realRefreshError(rt: string, at: string) {
  const config = {
    url: '/auth/refresh',
    method: 'post',
    data: JSON.stringify({ refreshToken: rt }),
    headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' },
  }
  return new AxiosError(
    'Request failed with status code 401',
    'ERR_BAD_REQUEST',
    config as never,
    {},
    { status: 401, data: {}, statusText: 'Unauthorized', headers: {}, config } as never,
  )
}

/** Every string reachable from a value, at any depth, cycles tolerated. */
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

describe('refresh race — tokens never leak', () => {
  const SECRETS = ['at-1', 'rt-1', 'at-2', 'rt-2']

  beforeEach(resetAll)
  afterEach(resetAll)

  it('sanity: the fixture error really does contain both tokens', () => {
    // Guards the two tests below: if this ever stops holding, they would be
    // proving nothing and would still pass.
    const haystack = deepStrings(realRefreshError('rt-1', 'at-1'))
    expect(haystack.some((v) => v.includes('rt-1'))).toBe(true)
    expect(haystack.some((v) => v.includes('at-1'))).toBe(true)
  })

  it('writes no token to the console on success or failure', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => {}),
    )
    setTokens('at-1', 'rt-1')

    api.defaults.adapter = ((config: InternalAxiosRequestConfig) =>
      String(config.headers?.Authorization ?? '') === 'Bearer at-2'
        ? ok(config)
        : unauthorized(config)) as never
    const post = vi
      .spyOn(axios, 'post')
      .mockResolvedValue({ data: { accessToken: 'at-2', refreshToken: 'rt-2' } } as never)

    await api.get('/alpha')

    // ...and again on the failure path. The adapter must now reject every
    // token, otherwise the retry succeeds and no refresh failure ever happens.
    api.defaults.adapter = ((config: InternalAxiosRequestConfig) =>
      unauthorized(config)) as never
    post.mockRejectedValue(realRefreshError('rt-2', 'at-2'))
    await expect(api.get('/beta')).rejects.toThrow('Refresh failed')

    const written = spies.flatMap((spy) => spy.mock.calls.flat()).flatMap((arg) => deepStrings(arg))
    for (const secret of SECRETS) {
      expect(written.some((line) => line.includes(secret))).toBe(false)
    }
  })

  it('rejects with an error carrying no token at any depth', async () => {
    setTokens('at-1', 'rt-1')

    api.defaults.adapter = ((config: InternalAxiosRequestConfig) =>
      unauthorized(config)) as never
    vi.spyOn(axios, 'post').mockRejectedValue(realRefreshError('rt-1', 'at-1'))

    const error = await api.get('/alpha').catch((e: unknown) => e)
    // Without this the walk below could be inspecting a ReferenceError.
    expect(error).toBeInstanceOf(RefreshFailedError)

    // Walk the whole object graph, and the serialisation an error reporter
    // would actually ship — not a replacer array, which filters at every depth
    // and so cannot see into config.data or config.headers.
    const haystack = [
      ...deepStrings(error),
      JSON.stringify((error as { toJSON?: () => unknown })?.toJSON?.() ?? {}),
    ]
    for (const secret of SECRETS) {
      expect(haystack.some((line) => line.includes(secret))).toBe(false)
    }
  })

  it('rejects a stale result with an error carrying no token', async () => {
    setTokens('at-A', 'rt-A')

    api.defaults.adapter = ((config: InternalAxiosRequestConfig) =>
      unauthorized(config)) as never
    vi.spyOn(axios, 'post').mockImplementation(async () => {
      setTokens('at-B', 'rt-B')
      return { data: { accessToken: 'at-A2', refreshToken: 'rt-A2' } } as never
    })

    const error = await api.get('/alpha').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(RefreshFailedError)

    const haystack = deepStrings(error)
    for (const secret of ['at-A', 'rt-A', 'at-B', 'rt-B', 'at-A2', 'rt-A2']) {
      expect(haystack.some((line) => line.includes(secret))).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// The two halves of the session must never disagree permanently.
// ---------------------------------------------------------------------------

describe('refresh race — client and store cannot desync permanently', () => {
  beforeEach(() => {
    resetAll()
    render(
      <Providers>
        <div />
      </Providers>,
    )
  })

  afterEach(resetAll)

  it('ends the session when a malformed 200 refresh arrives', async () => {
    store().setAuth(USER, 'at-1', 'rt-1')
    setTokens('at-1', 'rt-1')

    api.defaults.adapter = ((config: InternalAxiosRequestConfig) =>
      unauthorized(config)) as never
    // A captive portal or proxy error page: HTTP 200, not a TokensDto.
    vi.spyOn(axios, 'post').mockResolvedValue({ data: '<html>proxy error</html>' } as never)

    await expect(api.get('/alpha')).rejects.toThrow('Malformed refresh response')

    // Neither half may be left holding a session the other has lost.
    expect(getAccessToken()).toBeNull()
    expect(getRefreshToken()).toBeNull()
    expect(store().isAuthenticated).toBe(false)
  })

  it('ends a store session that the axios client no longer has tokens for', async () => {
    // The production route into the desync, not a simulation of its end state:
    // a truncated or quota-failed persist write leaves isAuthenticated true
    // with no refresh token, and AuthHydration then declines to fill the axios
    // module because it requires BOTH tokens. The desync exists at mount.
    localStorage.setItem(
      'inventory-auth',
      JSON.stringify({
        state: {
          user: USER,
          accessToken: 'at-1',
          refreshToken: null,
          isAuthenticated: true,
        },
        version: 1,
      }),
    )
    await act(async () => {
      await useAuthStore.persist.rehydrate()
    })

    expect(store().isAuthenticated).toBe(true)
    expect(getRefreshToken()).toBeNull()

    api.defaults.adapter = ((config: InternalAxiosRequestConfig) =>
      unauthorized(config)) as never
    // Must never be reached: with no refresh token there is nothing to send.
    const post = vi.spyOn(axios, 'post')

    await expect(api.get('/alpha')).rejects.toThrow('No refresh token')
    expect(post).not.toHaveBeenCalled()

    // Previously this left an unkillable session: the client emitted a logout
    // naming no token, and the store discarded it forever.
    expect(store().isAuthenticated).toBe(false)
    expect(store().user).toBeNull()
  })
})
