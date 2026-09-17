import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@/lib/api/auth.api', () => ({
  authApi: { logout: vi.fn().mockResolvedValue(undefined), me: vi.fn() },
}))

vi.mock('@/lib/api/users.api', () => ({
  usersApi: {
    list: vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 }),
    getById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateStatus: vi.fn(),
    resendInvitation: vi.fn(),
    revokeInvitation: vi.fn(),
  },
}))

import { AppRoutes } from '@/app/routes'
import { useAuthStore } from '@/stores/auth.store'
import type { User } from '@/types'

function baseUser(role: User['role']): User {
  return {
    id: 'me-1',
    name: 'Usuário Teste',
    email: 'teste@example.com',
    role,
    isActive: true,
    createdAt: '2026-01-01',
    emailVerifiedAt: '2026-01-01',
    passwordSetAt: '2026-01-01',
  }
}

function renderApp() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <AppRoutes />
    </QueryClientProvider>,
  )
}

describe('admin users area — access control', () => {
  beforeEach(() => {
    localStorage.clear()
    useAuthStore.getState().clearAuth()
  })

  it('lets an admin reach /users', async () => {
    useAuthStore.getState().setAuth(baseUser('admin'), 'at-1', 'rt-1')
    window.history.replaceState({}, '', '/users')

    renderApp()

    // A generous timeout: this route is behind React.lazy, and under the
    // full suite's parallel load the chunk resolution plus the initial fetch
    // can occasionally take longer than vitest's default 1000ms.
    await waitFor(
      () => expect(screen.getByRole('heading', { name: 'Usuários' })).toBeInTheDocument(),
      { timeout: 5000 },
    )
    expect(window.location.pathname).toBe('/users')
  })

  it.each<User['role']>(['attendant', 'financial'])(
    'sends an authenticated %s to /403',
    async (role) => {
      useAuthStore.getState().setAuth(baseUser(role), 'at-1', 'rt-1')
      window.history.replaceState({}, '', '/users')

      renderApp()

      await waitFor(() => expect(window.location.pathname).toBe('/403'))
    },
  )

  it('sends an unauthenticated visitor to /login', async () => {
    window.history.replaceState({}, '', '/users')

    renderApp()

    await waitFor(() => expect(window.location.pathname).toBe('/login'))
  })

  it('also guards /users/new and /users/:id/edit for a non-admin', async () => {
    useAuthStore.getState().setAuth(baseUser('attendant'), 'at-1', 'rt-1')
    window.history.replaceState({}, '', '/users/new')

    renderApp()

    await waitFor(() => expect(window.location.pathname).toBe('/403'))
  })
})
