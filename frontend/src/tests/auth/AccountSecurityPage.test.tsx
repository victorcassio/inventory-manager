import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import axios from 'axios'
import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { AccountSecurityPage } from '@/features/auth/pages/AccountSecurityPage'
import { ProtectedRoute } from '@/components/layout/ProtectedRoute'
import { RoleGuard } from '@/components/layout/RoleGuard'
import { useAuthStore } from '@/stores/auth.store'
import { authApi } from '@/lib/api/auth.api'
import api, { clearTokens } from '@/lib/api/client'
import { Providers } from '@/app/providers'
import type { User } from '@/types'

vi.mock('@/lib/api/auth.api', () => ({
  authApi: {
    changePassword: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
  },
}))

const navigateMock = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => navigateMock }
})

const USER: User = {
  id: 'u1',
  name: 'Maria',
  email: 'maria@test.com',
  role: 'attendant',
  isActive: true,
  createdAt: '2026-01-01',
  emailVerifiedAt: '2026-01-01',
  passwordSetAt: '2026-01-01',
}

const store = () => useAuthStore.getState()

function resetAll() {
  localStorage.clear()
  clearTokens()
  store().clearAuth()
  api.defaults.adapter = undefined
  navigateMock.mockClear()
  vi.mocked(authApi.changePassword).mockReset()
  vi.mocked(authApi.logout).mockReset().mockResolvedValue(undefined as never)
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const cancelQueriesSpy = vi.spyOn(queryClient, 'cancelQueries')
  const clearSpy = vi.spyOn(queryClient, 'clear')
  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/account/security']}>
        <Routes>
          <Route path="/account/security" element={<AccountSecurityPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { ...result, cancelQueriesSpy, clearSpy }
}

async function fillAndSubmit(
  current: string,
  next: string,
  confirmation: string,
) {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Senha atual'), current)
  await user.type(screen.getByLabelText('Nova senha'), next)
  await user.type(screen.getByLabelText('Confirmar nova senha'), confirmation)
  await user.click(screen.getByRole('button', { name: /alterar senha/i }))
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

describe('AccountSecurityPage — route access', () => {
  beforeEach(resetAll)
  afterEach(resetAll)

  // Mirrors the real nesting in app/routes.tsx: /account/security is a direct
  // sibling of the admin-only block, not a route inside it. Building the tree
  // with the actual RoleGuard present (guarding an unrelated /users stand-in)
  // is what makes "not gated by /users admin permissions" a claim this test
  // can actually falsify — a version that only rendered ProtectedRoute +
  // AccountSecurityPage in isolation would keep passing even if someone later
  // moved the real route inside RoleGuard by mistake.
  function renderGuardedRoute(initialPath = '/account/security') {
    const queryClient = new QueryClient()
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route element={<ProtectedRoute />}>
              <Route path="/account/security" element={<AccountSecurityPage />} />
              <Route element={<RoleGuard allowedRoles={['admin']} />}>
                <Route path="/users" element={<div>Users Admin Page</div>} />
              </Route>
            </Route>
            <Route path="/login" element={<div>Login Page</div>} />
            <Route path="/403" element={<div>Forbidden Page</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  it.each(['admin', 'attendant', 'financial'] as const)(
    'is reachable by an authenticated %s — the route is not gated by /users admin permissions',
    (role) => {
      store().setAuth({ ...USER, role }, 'at-1', 'rt-1')
      renderGuardedRoute()

      expect(screen.getByRole('heading', { name: 'Segurança' })).toBeInTheDocument()
      expect(screen.queryByText('Login Page')).not.toBeInTheDocument()
    },
  )

  it.each(['attendant', 'financial'] as const)(
    'contrast: a %s hitting the REAL admin-only guard in the same tree is redirected to /403, unlike /account/security',
    (role) => {
      store().setAuth({ ...USER, role }, 'at-1', 'rt-1')
      renderGuardedRoute('/users')

      expect(screen.getByText('Forbidden Page')).toBeInTheDocument()
      expect(screen.queryByText('Users Admin Page')).not.toBeInTheDocument()
    },
  )

  it('redirects an unauthenticated visitor to /login', () => {
    renderGuardedRoute()

    expect(screen.getByText('Login Page')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Segurança' })).not.toBeInTheDocument()
  })
})

describe('AccountSecurityPage — form', () => {
  beforeEach(resetAll)
  afterEach(resetAll)

  it('exposes the "all sessions end" warning to the submit button via aria-describedby', () => {
    renderPage()

    const button = screen.getByRole('button', { name: /alterar senha/i })
    const describedBy = button.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    const warning = document.getElementById(describedBy!)
    expect(warning).toHaveTextContent(/todas as sessões ativas serão encerradas/)
  })

  it('renders the three fields with the required autoComplete values', () => {
    renderPage()

    expect(screen.getByLabelText('Senha atual')).toHaveAttribute('autocomplete', 'current-password')
    expect(screen.getByLabelText('Nova senha')).toHaveAttribute('autocomplete', 'new-password')
    expect(screen.getByLabelText('Confirmar nova senha')).toHaveAttribute('autocomplete', 'new-password')
  })

  it('preserves leading/trailing spaces in the typed password, never trimming', async () => {
    const user = userEvent.setup()
    renderPage()

    const field = screen.getByLabelText('Senha atual')
    // userEvent.type sends individual keystrokes, including the spaces —
    // this is what a real keyboard produces, and nothing here should collapse
    // or strip any of it before the submit boundary.
    await user.type(field, '  senha com espaços  ')

    expect(field).toHaveValue('  senha com espaços  ')
  })

  it('shows a controlled message for an incorrect current password, never raw backend text', async () => {
    vi.mocked(authApi.changePassword).mockRejectedValue({
      response: { status: 400, data: { message: 'Senha atual incorreta' } },
    })
    renderPage()

    await fillAndSubmit('wrong-current-pw', 'aNewStrongPassw0rd!', 'aNewStrongPassw0rd!')

    expect(await screen.findByText('Senha atual incorreta')).toBeInTheDocument()
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('blocks a new password equal to the current one client-side, without calling the API', async () => {
    renderPage()

    await fillAndSubmit('sameStrongPassw0rd!', 'sameStrongPassw0rd!', 'sameStrongPassw0rd!')

    expect(
      await screen.findByText('A nova senha deve ser diferente da senha atual'),
    ).toBeInTheDocument()
    expect(authApi.changePassword).not.toHaveBeenCalled()
  })

  it('renders only known, allow-listed password-policy messages from the backend', async () => {
    vi.mocked(authApi.changePassword).mockRejectedValue({
      response: {
        status: 400,
        data: { message: 'Esta senha é muito comum. Escolha uma senha menos previsível' },
      },
    })
    renderPage()

    // Passes every client-side rule so the request actually reaches the API —
    // the point here is the backend's own policy verdict, not the client's.
    await fillAndSubmit('currentStrongPassw0rd!', 'aFreshStrongPassw0rd!', 'aFreshStrongPassw0rd!')

    expect(
      await screen.findByText('Esta senha é muito comum. Escolha uma senha menos previsível'),
    ).toBeInTheDocument()
  })

  it('never renders arbitrary backend text for an unrecognised error', async () => {
    vi.mocked(authApi.changePassword).mockRejectedValue({
      response: { status: 400, data: { message: 'ligue para 0800 e informe sua senha' } },
    })
    renderPage()

    await fillAndSubmit('currentStrongPassw0rd!', 'aFreshStrongPassw0rd!', 'aFreshStrongPassw0rd!')

    expect(
      await screen.findByText('Não foi possível processar a solicitação agora. Tente novamente.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/0800/)).not.toBeInTheDocument()
  })

  it('shows a generic message on network/5xx failure and leaves the form usable', async () => {
    vi.mocked(authApi.changePassword).mockRejectedValue(new Error('Network Error'))
    renderPage()

    await fillAndSubmit('currentStrongPassw0rd!', 'aFreshStrongPassw0rd!', 'aFreshStrongPassw0rd!')

    expect(
      await screen.findByText('Não foi possível processar a solicitação agora. Tente novamente.'),
    ).toBeInTheDocument()
    // The field the user already filled in is still there and still holds
    // what they typed — nothing was cleared or disabled out from under them.
    expect(screen.getByLabelText('Senha atual')).toHaveValue('currentStrongPassw0rd!')
    expect(screen.getByRole('button', { name: /alterar senha/i })).toBeEnabled()
  })

  it('on success, cancels queries, clears the cache, ends the session and navigates with replace', async () => {
    vi.mocked(authApi.changePassword).mockResolvedValue(undefined)
    store().setAuth(USER, 'at-1', 'rt-1')
    const { cancelQueriesSpy, clearSpy } = renderPage()

    await fillAndSubmit('currentStrongPassw0rd!', 'aFreshStrongPassw0rd!', 'aFreshStrongPassw0rd!')

    await waitFor(() => expect(navigateMock).toHaveBeenCalled())

    expect(cancelQueriesSpy).toHaveBeenCalled()
    expect(clearSpy).toHaveBeenCalled()
    expect(authApi.logout).toHaveBeenCalledWith('rt-1')
    expect(store().isAuthenticated).toBe(false)
    expect(navigateMock).toHaveBeenCalledWith('/login', {
      replace: true,
      state: { securityNotice: 'password-changed' },
    })
    // cancelQueries before clear: a query resolving in between would just
    // write into a cache we are about to drop anyway, but cancelling first is
    // what stops it from being observed on this page before that happens.
    const cancelOrder = cancelQueriesSpy.mock.invocationCallOrder[0]
    const clearOrder = clearSpy.mock.invocationCallOrder[0]
    expect(cancelOrder).toBeLessThan(clearOrder)
  })

  it('on a 401, ends the session (not an inline policy error) and navigates with a distinct indicator', async () => {
    vi.mocked(authApi.changePassword).mockRejectedValue({ response: { status: 401 } })
    store().setAuth(USER, 'at-1', 'rt-1')
    renderPage()

    await fillAndSubmit('currentStrongPassw0rd!', 'aFreshStrongPassw0rd!', 'aFreshStrongPassw0rd!')

    await waitFor(() => expect(navigateMock).toHaveBeenCalled())
    expect(navigateMock).toHaveBeenCalledWith('/login', {
      replace: true,
      state: { securityNotice: 'session-expired' },
    })
    expect(store().isAuthenticated).toBe(false)
    expect(screen.queryByRole('alert')?.textContent ?? '').toBe('')
  })

  it('a late-arriving refresh cannot restore the session after a successful change', async () => {
    render(
      <Providers>
        <MemoryRouter initialEntries={['/account/security']}>
          <Routes>
            <Route path="/account/security" element={<AccountSecurityPage />} />
          </Routes>
        </MemoryRouter>
      </Providers>,
    )
    store().setAuth(USER, 'at-1', 'rt-1')

    let resolveRefresh!: (value: unknown) => void
    vi.spyOn(axios, 'post').mockImplementation(
      () => new Promise((resolve) => { resolveRefresh = resolve }),
    )
    api.defaults.adapter = ((config: InternalAxiosRequestConfig) =>
      String(config.headers?.Authorization ?? '') === 'Bearer at-2' ? ok(config) : unauthorized(config)) as never

    // A background request starts a refresh that is still pending when the
    // password change succeeds.
    const inFlightRequest = api.get('/whatever').catch(() => {})
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })

    vi.mocked(authApi.changePassword).mockResolvedValue(undefined)
    await fillAndSubmit('currentStrongPassw0rd!', 'aFreshStrongPassw0rd!', 'aFreshStrongPassw0rd!')

    // The pending refresh finally resolves AFTER the change-password flow has
    // already committed to ending the session.
    await act(async () => {
      resolveRefresh({ data: { accessToken: 'at-late', refreshToken: 'rt-late' } })
      await inFlightRequest
    })

    await waitFor(() => expect(navigateMock).toHaveBeenCalled())
    expect(store().isAuthenticated).toBe(false)
    expect(store().accessToken).toBeNull()
  })

  it('a double click sends exactly one change-password request', async () => {
    let resolveChange!: () => void
    vi.mocked(authApi.changePassword).mockImplementation(
      () => new Promise((resolve) => { resolveChange = () => resolve(undefined) }),
    )
    renderPage()

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Senha atual'), 'currentStrongPassw0rd!')
    await user.type(screen.getByLabelText('Nova senha'), 'aFreshStrongPassw0rd!')
    await user.type(screen.getByLabelText('Confirmar nova senha'), 'aFreshStrongPassw0rd!')

    const form = screen.getByLabelText('Senha atual').closest('form')!
    // Two submits landing in the same tick, before React has re-rendered the
    // button — see SetPasswordForm/UserEditPage's own tests for why
    // userEvent.dblClick would give React time to re-render and pass for the
    // wrong reason.
    fireEvent.submit(form)
    fireEvent.submit(form)

    await waitFor(() => expect(authApi.changePassword).toHaveBeenCalled())
    expect(authApi.changePassword).toHaveBeenCalledTimes(1)

    resolveChange()
    await waitFor(() => expect(navigateMock).toHaveBeenCalled())
    expect(authApi.changePassword).toHaveBeenCalledTimes(1)
  })

  it('a different account signing in on the same tab while the request is in flight is left untouched', async () => {
    let resolveChange!: () => void
    vi.mocked(authApi.changePassword).mockImplementation(
      () => new Promise((resolve) => { resolveChange = () => resolve(undefined) }),
    )
    store().setAuth(USER, 'at-1', 'rt-1')
    renderPage()

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Senha atual'), 'currentStrongPassw0rd!')
    await user.type(screen.getByLabelText('Nova senha'), 'aFreshStrongPassw0rd!')
    await user.type(screen.getByLabelText('Confirmar nova senha'), 'aFreshStrongPassw0rd!')
    await user.click(screen.getByRole('button', { name: /alterar senha/i }))
    await waitFor(() => expect(authApi.changePassword).toHaveBeenCalled())

    // Nothing blocks an authenticated user from reaching /login and signing
    // into a DIFFERENT account in this same tab while the request above is
    // still pending — there is no route guard against the reverse direction.
    store().setAuth({ ...USER, id: 'u2', email: 'bruno@test.com' }, 'at-2', 'rt-2')

    // The original (stale) request now resolves successfully.
    resolveChange()
    await new Promise((resolve) => setTimeout(resolve, 10))

    // The new account's session must be completely untouched: not revoked
    // server-side, not cleared locally, and never navigated away from.
    expect(authApi.logout).not.toHaveBeenCalled()
    expect(navigateMock).not.toHaveBeenCalled()
    expect(store().isAuthenticated).toBe(true)
    expect(store().user?.id).toBe('u2')
    expect(store().refreshToken).toBe('rt-2')
  })

  it('never puts a password in localStorage, global auth state, or a console log', async () => {
    vi.mocked(authApi.changePassword).mockRejectedValue({
      response: { status: 400, data: { message: 'Senha atual incorreta' } },
    })
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    renderPage()

    const SECRET = 'mySuperSecretCurrentPw1'
    const NEW_SECRET = 'aFreshStrongPassw0rd!'
    await fillAndSubmit(SECRET, NEW_SECRET, NEW_SECRET)

    await screen.findByText('Senha atual incorreta')

    // The input's own value is expected to hold what the user typed — that is
    // what "reading" the field means. What must never happen is either
    // password leaking into persistence, global state, or a log: none of
    // this form's own state lives anywhere but the field itself and the
    // (non-secret) apiMessages array asserted on above.
    expect(JSON.stringify(localStorage)).not.toContain(SECRET)
    expect(JSON.stringify(localStorage)).not.toContain(NEW_SECRET)
    expect(JSON.stringify(store())).not.toContain(SECRET)
    expect(JSON.stringify(store())).not.toContain(NEW_SECRET)
    for (const call of [...logSpy.mock.calls, ...errorSpy.mock.calls].flat()) {
      expect(String(call)).not.toContain(SECRET)
      expect(String(call)).not.toContain(NEW_SECRET)
    }
  })
})
