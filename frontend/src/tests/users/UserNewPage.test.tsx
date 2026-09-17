import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { UserNewPage } from '@/features/users/pages/UserNewPage'
import { usersApi } from '@/lib/api/users.api'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CREATED_MESSAGE, CREATED_MAIL_FAILED_MESSAGE } from '@/features/users/hooks/useUsers'
import type { AdminUser } from '@/types'

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}))
vi.mock('@/lib/api/users.api', () => ({
  usersApi: {
    create: vi.fn(),
    list: vi.fn(),
    getById: vi.fn(),
    update: vi.fn(),
    updateStatus: vi.fn(),
    resendInvitation: vi.fn(),
    revokeInvitation: vi.fn(),
  },
}))

const navigateMock = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => navigateMock }
})

function makeAdminUser(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: 'u-new',
    name: 'Nova Pessoa',
    email: 'nova@example.com',
    role: 'attendant',
    isActive: true,
    emailVerifiedAt: null,
    passwordSetAt: null,
    lastLogin: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    invitationStatus: 'pending',
    invitationExpiresAt: '2026-01-02T00:00:00Z',
    ...overrides,
  }
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <UserNewPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Nome'), 'Nova Pessoa')
  await user.type(screen.getByLabelText('E-mail'), 'nova@example.com')
  await user.click(screen.getByRole('combobox', { name: /perfil/i }))
  await user.click(screen.getByRole('option', { name: 'Atendente' }))
  await user.click(screen.getByRole('button', { name: /cadastrar usuário/i }))
}

describe('UserNewPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows a success toast and navigates back to the list when the invite is sent', async () => {
    const user = userEvent.setup()
    vi.mocked(usersApi.create).mockResolvedValue({
      user: makeAdminUser(),
      invitationEmailSent: true,
    })
    renderPage()

    await fillAndSubmit(user)

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(CREATED_MESSAGE))
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/users'))
    expect(toast.warning).not.toHaveBeenCalled()
  })

  it('warns clearly, offering the resend path, when the invite could not be sent', async () => {
    const user = userEvent.setup()
    vi.mocked(usersApi.create).mockResolvedValue({
      user: makeAdminUser(),
      invitationEmailSent: false,
    })
    renderPage()

    await fillAndSubmit(user)

    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(CREATED_MAIL_FAILED_MESSAGE))
    expect(CREATED_MAIL_FAILED_MESSAGE).toMatch(/reenviar convite/i)
    expect(toast.success).not.toHaveBeenCalled()
    // The user is still created, so the admin still goes back to the list to
    // find it and use "Reenviar convite" from there.
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/users'))
  })

  it('does not send a second create request when two submits land in the same tick', async () => {
    const user = userEvent.setup()
    let resolveCreate!: (value: { user: AdminUser; invitationEmailSent: boolean }) => void
    vi.mocked(usersApi.create).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve
        }),
    )
    renderPage()

    await user.type(screen.getByLabelText('Nome'), 'Nova Pessoa')
    await user.type(screen.getByLabelText('E-mail'), 'nova@example.com')
    await user.click(screen.getByRole('combobox', { name: /perfil/i }))
    await user.click(screen.getByRole('option', { name: 'Atendente' }))

    // A real double click gives React time to re-render and disable the
    // button in between (aria-disabled does not even block a click) — it is
    // not the window that matters. Two submit events in one tick, a fast
    // double click or Enter racing a click, is the case that gets through,
    // and here it would fire a second invitation for the same user.
    const form = screen.getByLabelText('Nome').closest('form')!
    fireEvent.submit(form)
    fireEvent.submit(form)
    await waitFor(() => expect(usersApi.create).toHaveBeenCalled())

    expect(usersApi.create).toHaveBeenCalledTimes(1)

    // The real risk is not a second CONCURRENT call — the mutations share a
    // scope, so React Query would only queue a second one, not run it in
    // parallel. The risk is that a queued second call still fires once the
    // first settles, creating (and inviting) the same person twice. Resolving
    // the first and waiting is what proves the second submission was
    // dropped outright, not merely delayed.
    resolveCreate({ user: makeAdminUser(), invitationEmailSent: true })
    await waitFor(() => expect(navigateMock).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(usersApi.create).toHaveBeenCalledTimes(1)
  })

  it('shows the known conflict message on a duplicate e-mail, staying on the form', async () => {
    const user = userEvent.setup()
    vi.mocked(usersApi.create).mockRejectedValue({
      response: { status: 409, data: { message: 'Já existe um usuário com este e-mail' } },
    })
    renderPage()

    await fillAndSubmit(user)

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Já existe um usuário com este e-mail'),
    )
    expect(navigateMock).not.toHaveBeenCalled()
  })
})
