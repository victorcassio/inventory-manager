import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import axios from 'axios'
import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { useAuthStore } from '@/stores/auth.store'
import api, {
  getAccessToken,
  getRefreshToken,
  setTokens,
  clearTokens,
  beginEndingSession,
} from '@/lib/api/client'
import { authApi } from '@/lib/api/auth.api'
import { endSession } from '@/features/auth/lib/endSession'
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

const store = () => useAuthStore.getState()

function resetAll() {
  localStorage.clear()
  clearTokens()
  store().clearAuth()
  api.defaults.adapter = undefined
  vi.restoreAllMocks()
}

/**
 * AuthHydration (mounted by Providers) is what listens for
 * auth:tokens-refreshed / auth:logout and applies them to the STORE — the
 * axios module's own copy updates regardless, but endSession's "did someone
 * else take over" check reads the store, exactly as the real app does. Tests
 * that exercise a real rotation need this mounted, same as refreshRace.test.tsx.
 */
function mountAuthHydration() {
  render(
    <Providers>
      <div />
    </Providers>,
  )
}

function unauthorized(config: InternalAxiosRequestConfig): Promise<AxiosResponse> {
  const error = Object.assign(new Error('Request failed with status code 401'), {
    config,
    isAxiosError: true,
    response: { data: {}, status: 401, statusText: 'Unauthorized', headers: {}, config },
  })
  return Promise.reject(error)
}

function ok(config: InternalAxiosRequestConfig, data: unknown = {}): Promise<AxiosResponse> {
  return Promise.resolve({ data, status: 200, statusText: 'OK', headers: {}, config } as AxiosResponse)
}

/**
 * These five scenarios are the ones a user-initiated logout can genuinely hit
 * without a second tab, documented here because the naive version of
 * endSession — read the refresh token, await authApi.logout(token), clear in
 * a finally — gets every one of them wrong. See endSession.ts's own doc
 * comment for the mechanism; this file is the proof.
 */
describe('endSession — the five races a slow /auth/logout call can hit', () => {
  beforeEach(resetAll)
  afterEach(resetAll)

  it('1) a refresh already running when logout is clicked: endSession waits for it before revoking', async () => {
    mountAuthHydration()
    store().setAuth(USER, 'at-1', 'rt-1')

    let resolveRefresh!: (value: unknown) => void
    const refreshCall = vi.spyOn(axios, 'post').mockImplementation(
      () => new Promise((resolve) => { resolveRefresh = resolve }),
    )
    // Every request looks unauthorized until the refreshed token shows up —
    // this is what makes the interceptor actually start a refresh.
    api.defaults.adapter = ((config: InternalAxiosRequestConfig) =>
      String(config.headers?.Authorization ?? '') === 'Bearer at-2' ? ok(config) : unauthorized(config)) as never

    // Fire a request that 401s and starts the refresh, but don't await it yet.
    const inFlightRequest = api.get('/whatever').catch(() => {})
    // Let the rejection reach the interceptor and start the refresh — this is
    // what makes pendingRefresh non-null before endSession reads it below.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })

    const logoutSpy = vi.spyOn(authApi, 'logout').mockResolvedValue(undefined as never)

    const endSessionCall = endSession()

    // endSession is still awaiting the refresh; it must not have revoked
    // anything yet.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
    expect(logoutSpy).not.toHaveBeenCalled()

    // The in-flight refresh now resolves with a rotated pair.
    await act(async () => {
      resolveRefresh({ data: { accessToken: 'at-2', refreshToken: 'rt-2' } })
      await inFlightRequest
    })

    const ended = await endSessionCall

    expect(ended).toBe(true)
    // The token actually revoked is the CURRENT one, not the one captured
    // before the rotation finished.
    expect(logoutSpy).toHaveBeenCalledWith('rt-2')
    expect(refreshCall).toHaveBeenCalledTimes(1)
  })

  it('2) rotation already finished before logout starts: the current (rotated) token is revoked', async () => {
    store().setAuth(USER, 'at-1', 'rt-1')
    // Simulate an ordinary rotation that already completed, unrelated to logout.
    setTokens('at-2', 'rt-2')
    store().updateTokens('at-2', 'rt-2')

    const logoutSpy = vi.spyOn(authApi, 'logout').mockResolvedValue(undefined as never)

    const ended = await endSession()

    expect(ended).toBe(true)
    expect(logoutSpy).toHaveBeenCalledWith('rt-2')
  })

  it('3) never sends the token a completed rotation already invalidated', async () => {
    store().setAuth(USER, 'at-1', 'rt-1')

    let resolveRefresh!: (value: unknown) => void
    vi.spyOn(axios, 'post').mockImplementation(
      () => new Promise((resolve) => { resolveRefresh = resolve }),
    )
    api.defaults.adapter = ((config: InternalAxiosRequestConfig) =>
      String(config.headers?.Authorization ?? '') === 'Bearer at-2' ? ok(config) : unauthorized(config)) as never

    const inFlightRequest = api.get('/whatever')
    await new Promise((resolve) => setTimeout(resolve, 10))

    const logoutSpy = vi.spyOn(authApi, 'logout').mockResolvedValue(undefined as never)

    const endSessionCall = endSession()
    await new Promise((resolve) => setTimeout(resolve, 10))
    resolveRefresh({ data: { accessToken: 'at-2', refreshToken: 'rt-2' } })
    await inFlightRequest
    await endSessionCall

    // The naive bug this closes: sending 'rt-1' would revoke nothing
    // server-side, since rotation already revoked that row itself.
    expect(logoutSpy).not.toHaveBeenCalledWith('rt-1')
  })

  it('4) a stale refresh result arriving after clearAuth() cannot revive the session', async () => {
    store().setAuth(USER, 'at-1', 'rt-1')
    const logoutSpy = vi.spyOn(authApi, 'logout').mockResolvedValue(undefined as never)

    const ended = await endSession()
    expect(ended).toBe(true)
    expect(store().isAuthenticated).toBe(false)

    // A refresh the ending flow never knew about answers late. Task 15's own
    // session-token correlation is what actually rejects this; endSession's
    // job was only to make sure nothing it started could still be running.
    window.dispatchEvent(
      new CustomEvent('auth:tokens-refreshed', {
        detail: { accessToken: 'at-late', refreshToken: 'rt-late', sourceRefreshToken: 'rt-1' },
      }),
    )

    expect(store().isAuthenticated).toBe(false)
    expect(getAccessToken()).toBeNull()
    expect(logoutSpy).toHaveBeenCalledWith('rt-1')
  })

  it('5) a new session started in this tab while the old logout call is still finishing is left alone', async () => {
    store().setAuth(USER, 'at-A', 'rt-A')

    let resolveLogout!: () => void
    const logoutSpy = vi.spyOn(authApi, 'logout').mockImplementation(
      () => new Promise((resolve) => { resolveLogout = () => resolve(undefined as never) }),
    )

    const endSessionCall = endSession()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(logoutSpy).toHaveBeenCalledWith('rt-A')

    // The user manually reaches /login and signs into a NEW session in the
    // SAME tab before the network call above resolves.
    store().setAuth({ ...USER, id: 'u2' }, 'at-B', 'rt-B')

    resolveLogout()
    const ended = await endSessionCall

    expect(ended).toBe(false)
    // Session B is untouched: still authenticated, still holding its own
    // tokens — not session A's, and not cleared.
    expect(store().isAuthenticated).toBe(true)
    expect(store().refreshToken).toBe('rt-B')
    expect(store().user?.id).toBe('u2')
    expect(getRefreshToken()).toBe('rt-B')
  })

  it('does not attempt a network call when there is no session to end', async () => {
    const logoutSpy = vi.spyOn(authApi, 'logout')

    const ended = await endSession()

    expect(ended).toBe(true)
    expect(logoutSpy).not.toHaveBeenCalled()
    expect(store().isAuthenticated).toBe(false)
  })

  it('bounds the best-effort revoke with a timeout, so a stalled logout call cannot strand sessionEnding forever', async () => {
    store().setAuth(USER, 'at-1', 'rt-1')
    // authApi.logout itself (not mocked here) is what must carry the bound —
    // spying one level up, on the shared axios instance, is what actually
    // exercises that real implementation rather than a test double of it.
    api.defaults.adapter = ((config: InternalAxiosRequestConfig) => ok(config)) as never
    const postSpy = vi.spyOn(api, 'post')

    await endSession()

    const [, , config] = postSpy.mock.calls[0] as [string, unknown, { timeout?: number } | undefined]
    expect(config?.timeout).toBeGreaterThan(0)
  })

  it('clears the session locally even when the server cannot be reached', async () => {
    store().setAuth(USER, 'at-1', 'rt-1')
    vi.spyOn(authApi, 'logout').mockRejectedValue(new Error('Network Error'))

    const ended = await endSession()

    expect(ended).toBe(true)
    expect(store().isAuthenticated).toBe(false)
    expect(getAccessToken()).toBeNull()
  })

  it('gates a NEW refresh once a session has committed to ending, even with a token still present', async () => {
    // beginEndingSession() alone, not the full endSession() cycle: this
    // isolates the gate itself from clearAuth() also having zeroed the
    // token, which would make "no refresh was attempted" true for the wrong
    // reason (nothing to refresh WITH, rather than the gate actually
    // stopping it).
    setTokens('at-1', 'rt-1')
    beginEndingSession()

    const postSpy = vi.spyOn(axios, 'post')
    api.defaults.adapter = ((config: InternalAxiosRequestConfig) => unauthorized(config)) as never

    await expect(api.get('/whatever')).rejects.toBeTruthy()

    // A real refresh token was sitting right there; the only reason nothing
    // was sent is the gate.
    expect(postSpy).not.toHaveBeenCalled()
  })

  it('re-enables refresh for a fresh login after an earlier logout attempt', async () => {
    store().setAuth(USER, 'at-1', 'rt-1')
    vi.spyOn(authApi, 'logout').mockResolvedValue(undefined as never)
    await endSession()

    // A fresh login must un-gate refreshing for the new session.
    store().setAuth({ ...USER, id: 'u2' }, 'at-2', 'rt-2')
    const refreshSpy = vi
      .spyOn(axios, 'post')
      .mockResolvedValue({ data: { accessToken: 'at-3', refreshToken: 'rt-3' } } as never)
    api.defaults.adapter = ((config: InternalAxiosRequestConfig) =>
      String(config.headers?.Authorization ?? '') === 'Bearer at-3' ? ok(config) : unauthorized(config)) as never

    await api.get('/whatever')
    expect(refreshSpy).toHaveBeenCalled()
  })
})
