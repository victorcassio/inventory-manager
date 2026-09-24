import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const navigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})

const resetPassword = vi.fn()
vi.mock('@/lib/api/auth.api', () => ({
  authApi: { resetPassword: (...args: unknown[]) => resetPassword(...args) },
}))

import { ResetPasswordPage } from '@/features/auth/pages/ResetPasswordPage'
import { useAuthStore } from '@/stores/auth.store'

const TOKEN = 'PvMlUjKZZz1QVsIbGHLTw2UKIQf4I-UavSNxeS-22gk'
const PASSWORD = 'uma senha bem comprida'

const apiError = (status: number, message?: unknown) => ({
  response: { status, data: message === undefined ? {} : { message } },
})

function renderPage() {
  return render(
    <MemoryRouter>
      <ResetPasswordPage />
    </MemoryRouter>,
  )
}

const submit = () => screen.getByRole('button', { name: /^redefinir senha$/i })

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Nova senha'), PASSWORD)
  await user.type(screen.getByLabelText('Confirmar nova senha'), PASSWORD)
  await user.click(submit())
}

describe('ResetPasswordPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    sessionStorage.clear()
    useAuthStore.getState().clearAuth()
    window.history.replaceState({}, '', `/reset-password#token=${TOKEN}`)
  })

  it('captures and strips the token, preserving a legitimate query', () => {
    window.history.replaceState({}, '', `/reset-password?from=email#token=${TOKEN}`)
    renderPage()

    expect(window.location.hash).toBe('')
    expect(window.location.search).toBe('?from=email')
    expect(submit()).toBeInTheDocument()
  })

  it('has no token after a refresh, and calls no API', () => {
    // First mount strips the fragment...
    const first = renderPage()
    first.unmount()

    // ...a refresh re-mounts against the stripped URL.
    renderPage()

    expect(screen.getByText(/link inválido ou expirado/i)).toBeInTheDocument()
    expect(resetPassword).not.toHaveBeenCalled()
  })

  it('sends the token only in the request body and returns to login with replace', async () => {
    const user = userEvent.setup()
    resetPassword.mockResolvedValue(undefined)
    renderPage()

    await fillAndSubmit(user)

    await waitFor(() => expect(resetPassword).toHaveBeenCalledWith(TOKEN, PASSWORD, PASSWORD))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/login', { replace: true }))
    // A reset revokes every session server-side; nothing is resumed here.
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    expect(JSON.stringify(localStorage)).not.toContain(TOKEN)
  })

  it('ends the flow on a rejected token', async () => {
    const user = userEvent.setup()
    resetPassword.mockRejectedValue(apiError(400, 'Link inválido ou expirado'))
    renderPage()

    await fillAndSubmit(user)

    expect(await screen.findByText(/link inválido ou expirado/i)).toBeInTheDocument()
    // The text alone is not enough: rendering the same sentence as an ordinary
    // API error would satisfy it while the terminal state never happened. The
    // form being gone is what distinguishes the two.
    expect(screen.queryByRole('button', { name: /^redefinir senha$/i })).not.toBeInTheDocument()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('shows policy messages on a 400', async () => {
    const user = userEvent.setup()
    resetPassword.mockRejectedValue(
      apiError(400, 'Esta senha é muito comum. Escolha uma senha menos previsível'),
    )
    renderPage()

    await fillAndSubmit(user)

    expect(await screen.findByText(/esta senha é muito comum/i)).toBeInTheDocument()
  })

  it.each([
    ['a 500', apiError(500, 'Internal server error')],
    ['a network failure', Object.assign(new Error('Network Error'), { request: {} })],
  ])('shows the safe retry message for %s', async (_label, failure) => {
    const user = userEvent.setup()
    resetPassword.mockRejectedValue(failure)
    renderPage()

    await fillAndSubmit(user)

    expect(await screen.findByText(/não foi possível processar a solicitação/i)).toBeInTheDocument()
    expect(document.body.innerHTML).not.toContain('Internal server error')
  })

  it('clears a session this browser was still holding', async () => {
    const user = userEvent.setup()
    resetPassword.mockResolvedValue(undefined)
    // Someone who resets a password because they think they were compromised,
    // in a browser still logged in as them.
    useAuthStore.getState().setAuth(
      {
        id: 'u1',
        name: 'Maria',
        email: 'maria@example.com',
        role: 'attendant',
        isActive: true,
        createdAt: '2026-01-01',
        emailVerifiedAt: '2026-01-01',
        passwordSetAt: '2026-01-01',
      },
      'at-antigo',
      'rt-antigo',
    )
    renderPage()

    await fillAndSubmit(user)

    await waitFor(() => expect(useAuthStore.getState().isAuthenticated).toBe(false))
    // Those credentials are dead server-side; leaving them on disk on a shared
    // machine, and admitting the user to the app shell on them, is the thing
    // the reset was supposed to end.
    expect(useAuthStore.getState().accessToken).toBeNull()
    expect(JSON.stringify(localStorage)).not.toContain('rt-antigo')
  })

  it('does not fire a second request when two submits land in the same tick', async () => {
    const user = userEvent.setup()
    let resolve: (value?: unknown) => void = () => {}
    resetPassword.mockImplementation(() => new Promise((r) => (resolve = r)))
    renderPage()

    await user.type(screen.getByLabelText('Nova senha'), PASSWORD)
    await user.type(screen.getByLabelText('Confirmar nova senha'), PASSWORD)

    // A double click via userEvent leaves React time to re-render and disable
    // the button between the two, so it never reaches the window that matters.
    // Two submit events in one tick — a fast double click, or Enter racing a
    // click — is the case that actually gets through, and on these endpoints a
    // duplicate burns the single-use token a second time.
    const form = screen.getByLabelText('Nova senha').closest('form')!
    fireEvent.submit(form)
    fireEvent.submit(form)
    await waitFor(() => expect(resetPassword).toHaveBeenCalled())

    expect(resetPassword).toHaveBeenCalledTimes(1)
    resolve()
  })
})
