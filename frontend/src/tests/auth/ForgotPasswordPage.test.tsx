import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

const forgotPassword = vi.fn()
vi.mock('@/lib/api/auth.api', () => ({
  authApi: { forgotPassword: (...args: unknown[]) => forgotPassword(...args) },
}))

import { ForgotPasswordPage } from '@/features/auth/pages/ForgotPasswordPage'

const EMAIL = 'maria@example.com'
const CONFIRMATION = /se o e-mail estiver cadastrado/i
const RETRY = /não foi possível processar a solicitação/i

const apiError = (status: number, message?: unknown) => ({
  response: { status, data: message === undefined ? {} : { message } },
})

function renderPage() {
  return render(
    <MemoryRouter>
      <ForgotPasswordPage />
    </MemoryRouter>,
  )
}

const submit = () => screen.getByRole('button', { name: /enviar instruções/i })

async function submitEmail(user: ReturnType<typeof userEvent.setup>, email = EMAIL) {
  await user.type(screen.getByLabelText('E-mail'), email)
  await user.click(submit())
}

describe('ForgotPasswordPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('asks the browser for an e-mail and labels the field', () => {
    renderPage()

    const field = screen.getByLabelText('E-mail')
    expect(field).toHaveAttribute('autocomplete', 'email')
    expect(field).toHaveAttribute('type', 'email')
  })

  it('shows the account-independent confirmation on a 2xx', async () => {
    const user = userEvent.setup()
    forgotPassword.mockResolvedValue({ message: 'ok' })
    renderPage()

    await submitEmail(user)

    expect(await screen.findByText(CONFIRMATION)).toBeInTheDocument()
    // The confirmation must not reveal whether the address exists.
    expect(document.body.innerHTML).not.toContain('não encontrado')
    expect(document.body.innerHTML).not.toContain('não cadastrado')
  })

  it('moves focus to the confirmation heading', async () => {
    const user = userEvent.setup()
    forgotPassword.mockResolvedValue({ message: 'ok' })
    renderPage()

    await submitEmail(user)

    await waitFor(() => expect(screen.getByText('Verifique seu e-mail')).toHaveFocus())
  })

  it.each([
    ['400', apiError(400, 'E-mail inválido')],
    ['429', apiError(429, 'ThrottlerException: Too Many Requests')],
    ['500', apiError(500, 'Internal server error')],
    ['network failure', Object.assign(new Error('Network Error'), { request: {} })],
    ['timeout', Object.assign(new Error('timeout of 0ms exceeded'), { code: 'ECONNABORTED' })],
  ])('shows the safe retry message for %s, never the confirmation', async (_label, failure) => {
    const user = userEvent.setup()
    forgotPassword.mockRejectedValue(failure)
    renderPage()

    await submitEmail(user)

    expect(await screen.findByText(RETRY)).toBeInTheDocument()
    // Claiming instructions were sent when the request never succeeded would
    // be a lie the user acts on by waiting for an e-mail that never arrives.
    expect(screen.queryByText(CONFIRMATION)).not.toBeInTheDocument()
    expect(document.body.innerHTML).not.toContain('ThrottlerException')
    expect(document.body.innerHTML).not.toContain('Internal server error')
  })

  it('rejects an invalid address without calling the API', async () => {
    const user = userEvent.setup()
    renderPage()

    await submitEmail(user, 'nao-e-um-email')

    expect(await screen.findByText('E-mail inválido')).toBeInTheDocument()
    expect(forgotPassword).not.toHaveBeenCalled()
  })

  it('rejects an address longer than the backend accepts, without calling the API', async () => {
    const user = userEvent.setup()
    renderPage()

    // The DTO caps at 150; without a matching client bound the user would get
    // class-validator's English default back from the server.
    await submitEmail(user, `${'a'.repeat(145)}@example.com`)

    expect(await screen.findByText('Máximo de 150 caracteres')).toBeInTheDocument()
    expect(forgotPassword).not.toHaveBeenCalled()
  })

  it('focuses the invalid field on a failed submit', async () => {
    const user = userEvent.setup()
    renderPage()

    await submitEmail(user, 'nao-e-um-email')

    await waitFor(() => expect(screen.getByLabelText('E-mail')).toHaveFocus())
  })

  it('does not fire a second request when two submits land in the same tick', async () => {
    const user = userEvent.setup()
    let resolve: (value?: unknown) => void = () => {}
    forgotPassword.mockImplementation(() => new Promise((r) => (resolve = r)))
    renderPage()

    await user.type(screen.getByLabelText('E-mail'), EMAIL)

    // The disabled button only helps after a re-render; two submits in one
    // tick get past it, and a duplicate here spends one of the five requests
    // the backend allows per 15 minutes.
    const form = screen.getByLabelText('E-mail').closest('form')!
    fireEvent.submit(form)
    fireEvent.submit(form)
    await waitFor(() => expect(forgotPassword).toHaveBeenCalled())

    expect(forgotPassword).toHaveBeenCalledTimes(1)
    resolve()
  })

  it('clears the previous error when the next attempt starts', async () => {
    const user = userEvent.setup()
    forgotPassword.mockRejectedValueOnce(apiError(500, 'Internal server error'))
    renderPage()

    await submitEmail(user)
    expect(await screen.findByText(RETRY)).toBeInTheDocument()

    forgotPassword.mockResolvedValueOnce({ message: 'ok' })
    await user.click(submit())

    expect(await screen.findByText(CONFIRMATION)).toBeInTheDocument()
    expect(screen.queryByText(RETRY)).not.toBeInTheDocument()
  })

  it('normalises the address before sending it', async () => {
    const user = userEvent.setup()
    forgotPassword.mockResolvedValue({ message: 'ok' })
    renderPage()

    await submitEmail(user, '  Maria@Example.COM ')

    await waitFor(() => expect(forgotPassword).toHaveBeenCalledWith(EMAIL))
  })
})
