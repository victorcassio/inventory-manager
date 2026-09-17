import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/lib/api/auth.api', () => ({
  authApi: {
    activateAccount: vi.fn(),
    resetPassword: vi.fn(),
    forgotPassword: vi.fn(),
    login: vi.fn(),
    me: vi.fn(),
  },
}))

import { AppRoutes } from '@/app/routes'
import { useAuthStore } from '@/stores/auth.store'

const TOKEN = 'PvMlUjKZZz1QVsIbGHLTw2UKIQf4I-UavSNxeS-22gk'

describe('public auth routes', () => {
  beforeEach(() => {
    localStorage.clear()
    useAuthStore.getState().clearAuth()
  })

  it.each([
    ['/forgot-password', /esqueci minha senha/i],
    [`/activate-account#token=${TOKEN}`, /ativar conta/i],
    [`/reset-password#token=${TOKEN}`, /redefinir senha/i],
  ])('serves %s to a visitor with no session', (url, heading) => {
    window.history.replaceState({}, '', url)

    render(<AppRoutes />)

    // Someone activating an account or resetting a password has no session by
    // definition: a redirect to /login would make the flow impossible.
    // getAllByText, because "Redefinir senha" is both the card title and the
    // submit label — the point here is that the page rendered at all.
    expect(screen.getAllByText(heading).length).toBeGreaterThan(0)
    expect(window.location.pathname).not.toBe('/login')
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })

  it('still redirects a protected route to the login screen', () => {
    window.history.replaceState({}, '', '/dashboard')

    render(<AppRoutes />)

    expect(window.location.pathname).toBe('/login')
  })
})
