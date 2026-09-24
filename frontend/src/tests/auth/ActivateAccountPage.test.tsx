import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const navigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})

const activateAccount = vi.fn()
vi.mock('@/lib/api/auth.api', () => ({
  authApi: { activateAccount: (...args: unknown[]) => activateAccount(...args) },
}))

import { ActivateAccountPage } from '@/features/auth/pages/ActivateAccountPage'
import { useAuthStore } from '@/stores/auth.store'

const TOKEN = 'PvMlUjKZZz1QVsIbGHLTw2UKIQf4I-UavSNxeS-22gk'
const PASSWORD = 'uma senha bem comprida'

const apiError = (status: number, message?: unknown) => ({
  response: { status, data: message === undefined ? {} : { message } },
})

function renderPage() {
  return render(
    <MemoryRouter>
      <ActivateAccountPage />
    </MemoryRouter>,
  )
}

const submit = () => screen.getByRole('button', { name: /definir senha/i })

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>, password = PASSWORD) {
  await user.type(screen.getByLabelText('Nova senha'), password)
  await user.type(screen.getByLabelText('Confirmar nova senha'), password)
  await user.click(submit())
}

describe('ActivateAccountPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    sessionStorage.clear()
    useAuthStore.getState().clearAuth()
    window.history.replaceState({}, '', `/activate-account#token=${TOKEN}`)
  })

  it('renders the form when the fragment carries a token', () => {
    renderPage()
    expect(submit()).toBeInTheDocument()
  })

  it('strips the token from the URL on mount', () => {
    renderPage()
    expect(window.location.hash).toBe('')
    expect(window.location.pathname).toBe('/activate-account')
  })

  it.each([
    ['missing', '/activate-account'],
    ['empty', '/activate-account#token='],
    ['malformed', '/activate-account#token=nao!valido'],
    ['duplicated', `/activate-account#token=${TOKEN}&token=${TOKEN}`],
  ])('shows the invalid-link state and calls no API when the token is %s', (_label, url) => {
    window.history.replaceState({}, '', url)
    renderPage()

    expect(screen.getByText(/link inválido ou expirado/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /definir senha/i })).not.toBeInTheDocument()
    expect(activateAccount).not.toHaveBeenCalled()
  })

  it('submits the fragment token in the request body, and nowhere else', async () => {
    const user = userEvent.setup()
    activateAccount.mockResolvedValue(undefined)
    renderPage()

    await fillAndSubmit(user)

    await waitFor(() => expect(activateAccount).toHaveBeenCalledWith(TOKEN, PASSWORD, PASSWORD))
    expect(JSON.stringify(localStorage)).not.toContain(TOKEN)
    expect(JSON.stringify(sessionStorage)).not.toContain(TOKEN)
    expect(JSON.stringify(useAuthStore.getState())).not.toContain(TOKEN)
    expect(window.location.href).not.toContain(TOKEN)
    expect(document.body.innerHTML).not.toContain(TOKEN)
  })

  it('preserves a password with spaces exactly', async () => {
    const user = userEvent.setup()
    activateAccount.mockResolvedValue(undefined)
    const spaced = '  senha  com   espaços  '
    renderPage()

    await fillAndSubmit(user, spaced)

    await waitFor(() => expect(activateAccount).toHaveBeenCalledWith(TOKEN, spaced, spaced))
  })

  it('goes to the login screen with replace, and authenticates nobody', async () => {
    const user = userEvent.setup()
    activateAccount.mockResolvedValue(undefined)
    renderPage()

    await fillAndSubmit(user)

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/login', { replace: true }))
    // Activation deliberately returns no tokens: the user logs in afterwards.
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    expect(useAuthStore.getState().accessToken).toBeNull()
  })

  it('shows the policy message on a 400 and stays on the form', async () => {
    const user = userEvent.setup()
    activateAccount.mockRejectedValue(
      apiError(400, 'A senha deve ter no mínimo 12 caracteres'),
    )
    renderPage()

    await fillAndSubmit(user)

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('A senha deve ter no mínimo 12 caracteres')).toBeInTheDocument()
    expect(submit()).toBeInTheDocument()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('ends the flow on a rejected token, with the fixed message', async () => {
    const user = userEvent.setup()
    activateAccount.mockRejectedValue(apiError(400, 'Link inválido ou expirado'))
    renderPage()

    await fillAndSubmit(user)

    expect(await screen.findByText(/link inválido ou expirado/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /definir senha/i })).not.toBeInTheDocument()
  })

  it.each([
    ['a 500', apiError(500, 'QueryFailedError: duplicate key value violates users_email_key')],
    ['a network failure', Object.assign(new Error('Network Error'), { request: {} })],
  ])('shows the safe retry message for %s, never the server text', async (_label, failure) => {
    const user = userEvent.setup()
    activateAccount.mockRejectedValue(failure)
    renderPage()

    await fillAndSubmit(user)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/não foi possível processar a solicitação/i)
    expect(document.body.innerHTML).not.toContain('QueryFailedError')
    expect(document.body.innerHTML).not.toContain('users_email_key')
  })

  it('clears a session this browser was still holding', async () => {
    const user = userEvent.setup()
    activateAccount.mockResolvedValue(undefined)
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
    // the activation was supposed to end.
    expect(useAuthStore.getState().accessToken).toBeNull()
    expect(JSON.stringify(localStorage)).not.toContain('rt-antigo')
  })

  it('does not fire a second request when two submits land in the same tick', async () => {
    const user = userEvent.setup()
    let resolve: (value?: unknown) => void = () => {}
    activateAccount.mockImplementation(() => new Promise((r) => (resolve = r)))
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
    await waitFor(() => expect(activateAccount).toHaveBeenCalled())

    expect(activateAccount).toHaveBeenCalledTimes(1)
    resolve()
  })

  it('disables the submit and says it is working while in flight', async () => {
    const user = userEvent.setup()
    let resolve: (value?: unknown) => void = () => {}
    activateAccount.mockImplementation(() => new Promise((r) => (resolve = r)))
    renderPage()

    await user.type(screen.getByLabelText('Nova senha'), PASSWORD)
    await user.type(screen.getByLabelText('Confirmar nova senha'), PASSWORD)
    await user.click(submit())

    const button = screen.getByRole('button', { name: /enviando/i })
    await waitFor(() => expect(button).toHaveAttribute('aria-busy', 'true'))
    // aria-disabled, not disabled: a disabled button is blurred to <body>, so
    // the user loses their place and never hears the label change.
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).not.toBeDisabled()
    await act(async () => {
      resolve()
    })
  })

  it('keeps focus on the submit button while the request runs', async () => {
    const user = userEvent.setup()
    let resolve: (value?: unknown) => void = () => {}
    activateAccount.mockImplementation(() => new Promise((r) => (resolve = r)))
    renderPage()

    await user.type(screen.getByLabelText('Nova senha'), PASSWORD)
    await user.type(screen.getByLabelText('Confirmar nova senha'), PASSWORD)
    await user.click(submit())

    // Disabling the control the user just activated drops focus to <body>:
    // the next Tab restarts at the top of the document.
    await waitFor(() => expect(activateAccount).toHaveBeenCalled())
    expect(document.activeElement).not.toBe(document.body)
    expect(screen.getByRole('button', { name: /enviando/i })).toHaveFocus()

    await act(async () => {
      resolve()
    })
  })

  it('associates the validation error with the field it belongs to', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText('Nova senha'), 'curta')
    await user.type(screen.getByLabelText('Confirmar nova senha'), 'curta')
    await user.click(submit())

    const field = await screen.findByLabelText('Nova senha')
    const describedBy = (field.getAttribute('aria-describedby') ?? '').split(' ')
    const message = screen.getByText('A senha deve ter no mínimo 12 caracteres')

    // The field also points at the requirements list. Passing that id must not
    // replace the error id, or the message stays on screen and is read by
    // nobody — on the very field RHF focuses after a failed submit.
    expect(describedBy).toContain(message.id)
    expect(describedBy.length).toBeGreaterThan(1)
    expect(field).toHaveAttribute('aria-invalid', 'true')
  })

  it('still looks busy after a second submit joins the first', async () => {
    const user = userEvent.setup()
    let resolve: (value?: unknown) => void = () => {}
    activateAccount.mockImplementation(() => new Promise((r) => (resolve = r)))
    renderPage()

    await user.type(screen.getByLabelText('Nova senha'), PASSWORD)
    await user.type(screen.getByLabelText('Confirmar nova senha'), PASSWORD)

    const form = screen.getByLabelText('Nova senha').closest('form')!
    fireEvent.submit(form)
    fireEvent.submit(form)
    await waitFor(() => expect(activateAccount).toHaveBeenCalled())

    // A dropped second submit would resolve its own RHF invocation
    // immediately, flipping isSubmitting back to false: spinner gone, label
    // reverted, inputs live again — while the request is still in flight.
    const button = screen.getByRole('button', { name: /enviando/i })
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button).toHaveAttribute('aria-disabled', 'true')

    await act(async () => {
      resolve()
    })
  })

  it('clears the previous error when the next attempt starts', async () => {
    const user = userEvent.setup()
    activateAccount.mockRejectedValueOnce(apiError(400, 'A senha deve ter no mínimo 12 caracteres'))
    renderPage()

    await fillAndSubmit(user)
    expect(await screen.findByText('A senha deve ter no mínimo 12 caracteres')).toBeInTheDocument()

    activateAccount.mockResolvedValueOnce(undefined)
    await user.click(submit())

    // A stale error sitting next to a spinner reads as a fresh failure.
    await waitFor(() =>
      expect(screen.queryByText('A senha deve ter no mínimo 12 caracteres')).not.toBeInTheDocument(),
    )
  })

  it('focuses the first invalid field instead of submitting', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText('Nova senha'), 'curta')
    await user.type(screen.getByLabelText('Confirmar nova senha'), 'curta')
    await user.click(submit())

    await waitFor(() => expect(screen.getByLabelText('Nova senha')).toHaveFocus())
    expect(activateAccount).not.toHaveBeenCalled()
  })

  it('moves focus to the terminal panel heading', async () => {
    window.history.replaceState({}, '', '/activate-account')
    renderPage()

    await waitFor(() =>
      expect(screen.getByText(/link inválido ou expirado/i)).toHaveFocus(),
    )
  })

  it('labels both fields and asks the browser for a new password', () => {
    renderPage()

    const password = screen.getByLabelText('Nova senha')
    const confirmation = screen.getByLabelText('Confirmar nova senha')
    expect(password).toHaveAttribute('autocomplete', 'new-password')
    expect(confirmation).toHaveAttribute('autocomplete', 'new-password')
    expect(password).toHaveAttribute('aria-describedby')
  })
})
