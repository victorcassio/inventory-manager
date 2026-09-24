import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { StrictMode } from 'react'
import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { useFragmentToken } from '@/features/auth/hooks/useFragmentToken'

// The shape the backend actually issues: randomBytes(32).toString('base64url'),
// 43 characters. A short stand-in would dodge the length bound the hook
// enforces and prove nothing about real links.
const TOKEN = 'PvMlUjKZZz1QVsIbGHLTw2UKIQf4I-UavSNxeS-22gk'

function Probe() {
  const token = useFragmentToken()
  return <span data-testid="token">{token ?? 'NO_TOKEN'}</span>
}

const tokenText = () => screen.getByTestId('token').textContent

describe('useFragmentToken', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/activate-account')
    localStorage.clear()
    sessionStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reads the token from the fragment and strips it', () => {
    window.history.replaceState({}, '', `/activate-account#token=${TOKEN}`)

    render(<Probe />)

    expect(tokenText()).toBe(TOKEN)
    expect(window.location.hash).toBe('')
    expect(window.location.pathname).toBe('/activate-account')
  })

  it('preserves the pathname and any legitimate query string', () => {
    window.history.replaceState({}, '', `/reset-password?from=email&lang=pt#token=${TOKEN}`)

    render(<Probe />)

    expect(tokenText()).toBe(TOKEN)
    expect(window.location.pathname).toBe('/reset-password')
    // The query is nobody's secret and may carry real state — only the
    // fragment goes.
    expect(window.location.search).toBe('?from=email&lang=pt')
    expect(window.location.hash).toBe('')
  })

  it('leaves a fragment that carries no token alone', () => {
    window.history.replaceState({}, '', '/activate-account#secao-2')

    render(<Probe />)

    expect(tokenText()).toBe('NO_TOKEN')
    // Destroying an in-page anchor would be a side effect nobody asked for.
    expect(window.location.hash).toBe('#secao-2')
  })

  it('still strips a fragment whose token is malformed', () => {
    window.history.replaceState({}, '', '/activate-account#token=nao-e-um-token-valido!!')

    render(<Probe />)

    expect(tokenText()).toBe('NO_TOKEN')
    // Rejected as a token, but it must not linger in the address bar either.
    expect(window.location.hash).toBe('')
  })

  it('keeps the history state object rather than replacing it with null', () => {
    window.history.replaceState({ idx: 7 }, '', `/activate-account#token=${TOKEN}`)

    render(<Probe />)

    expect(window.history.state).toEqual({ idx: 7 })
  })

  it('captures once and strips once under StrictMode double invocation', () => {
    window.history.replaceState({}, '', `/activate-account#token=${TOKEN}`)
    const replaceState = vi.spyOn(window.history, 'replaceState')

    render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    )

    expect(tokenText()).toBe(TOKEN)
    // StrictMode runs the initializer and the effect twice. The initializer is
    // pure, and the effect is guarded on the fragment still carrying a token,
    // so the URL is rewritten exactly once.
    expect(replaceState).toHaveBeenCalledTimes(1)
    expect(window.location.hash).toBe('')
  })

  it('returns null when there is no fragment', () => {
    render(<Probe />)
    expect(tokenText()).toBe('NO_TOKEN')
  })

  it('returns null for an empty, valueless, duplicated or malformed token', () => {
    const cases = [
      '/activate-account#token=',
      '/activate-account#token',
      '/activate-account#',
      `/activate-account#token=${TOKEN}&token=${TOKEN}`,
      '/activate-account#token=nao valido',
      '/activate-account#token=has/slash+plus',
      '/activate-account#outra=coisa',
      // Shaped right but far longer than any token the backend can issue, and
      // longer than the DTO accepts.
      `/activate-account#token=${'A'.repeat(300)}`,
      // Shaped right but implausibly short.
      '/activate-account#token=abc',
    ]

    for (const url of cases) {
      window.history.replaceState({}, '', url)
      const { unmount } = render(<Probe />)
      // Null is what keeps the page from calling the API with junk: the pages
      // render their invalid-link state instead.
      expect(tokenText(), url).toBe('NO_TOKEN')
      unmount()
    }
  })

  it('has no token after a refresh, because the fragment is gone', () => {
    window.history.replaceState({}, '', `/reset-password#token=${TOKEN}`)

    const first = render(<Probe />)
    expect(tokenText()).toBe(TOKEN)
    first.unmount()

    // A refresh re-mounts against the URL as it now stands. By design the token
    // is unrecoverable: it lived only in component memory.
    render(<Probe />)
    expect(tokenText()).toBe('NO_TOKEN')
  })

  it('never writes the token to localStorage or sessionStorage', () => {
    window.history.replaceState({}, '', `/reset-password#token=${TOKEN}`)
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    render(<Probe />)

    expect(JSON.stringify(localStorage)).not.toContain(TOKEN)
    expect(JSON.stringify(sessionStorage)).not.toContain(TOKEN)
    // Belt and braces: not even a write that was later removed.
    for (const call of setItem.mock.calls) {
      expect(String(call[1])).not.toContain(TOKEN)
    }
  })

  it('does not import the router, which would put the token in router state', () => {
    // react-router keeps search params in its own state and in the history
    // entry. Reading the token through it would defeat the point of the
    // fragment. An import, not a mention: the comments may legitimately explain
    // why the router is being avoided.
    const source = readFileSync(
      resolve(__dirname, '../../features/auth/hooks/useFragmentToken.ts'),
      'utf-8',
    )
    expect(source).not.toMatch(/from\s+['"]react-router/)
    expect(source).not.toMatch(/\buseSearchParams\s*\(/)
  })
})
