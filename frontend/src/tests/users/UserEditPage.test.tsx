import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { UserEditPage } from '@/features/users/pages/UserEditPage'
import { usersApi } from '@/lib/api/users.api'
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
    id: 'u-1',
    name: 'Carlos Financeiro',
    email: 'carlos@example.com',
    role: 'financial',
    isActive: true,
    emailVerifiedAt: '2026-01-01T00:00:00Z',
    passwordSetAt: '2026-01-01T00:00:00Z',
    lastLogin: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    invitationStatus: 'accepted',
    invitationExpiresAt: null,
    ...overrides,
  }
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/users/u-1/edit']}>
        <Routes>
          <Route path="/users/:id/edit" element={<UserEditPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('UserEditPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(usersApi.getById).mockResolvedValue(makeAdminUser())
  })

  it('loads the user and pre-fills the form', async () => {
    renderPage()

    await waitFor(() => expect(screen.getByLabelText('Nome')).toHaveValue('Carlos Financeiro'))
    expect(screen.getByLabelText('E-mail')).toHaveValue('carlos@example.com')
  })

  it('saves changes and navigates back to the list', async () => {
    const user = userEvent.setup()
    vi.mocked(usersApi.update).mockResolvedValue(makeAdminUser({ name: 'Carlos Editado' }))
    renderPage()

    await waitFor(() => expect(screen.getByLabelText('Nome')).toHaveValue('Carlos Financeiro'))
    await user.clear(screen.getByLabelText('Nome'))
    await user.type(screen.getByLabelText('Nome'), 'Carlos Editado')
    await user.click(screen.getByRole('button', { name: /salvar alterações/i }))

    await waitFor(() =>
      expect(usersApi.update).toHaveBeenCalledWith(
        'u-1',
        expect.objectContaining({ name: 'Carlos Editado' }),
      ),
    )
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/users'))
  })

  it('does not send a second update when two submits land in the same tick', async () => {
    let resolveUpdate!: (value: AdminUser) => void
    vi.mocked(usersApi.update).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpdate = resolve
        }),
    )
    renderPage()

    await waitFor(() => expect(screen.getByLabelText('Nome')).toHaveValue('Carlos Financeiro'))

    const form = screen.getByLabelText('Nome').closest('form')!
    fireEvent.submit(form)
    fireEvent.submit(form)
    await waitFor(() => expect(usersApi.update).toHaveBeenCalled())

    expect(usersApi.update).toHaveBeenCalledTimes(1)

    resolveUpdate(makeAdminUser())
    await waitFor(() => expect(navigateMock).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(usersApi.update).toHaveBeenCalledTimes(1)
  })

  it('shows an error state with retry when the user cannot be loaded', async () => {
    const user = userEvent.setup()
    vi.mocked(usersApi.getById).mockRejectedValueOnce(new Error('network'))
    vi.mocked(usersApi.getById).mockResolvedValueOnce(makeAdminUser())
    renderPage()

    const retryButton = await screen.findByRole('button', { name: /tentar novamente/i })
    await user.click(retryButton)

    await waitFor(() => expect(screen.getByLabelText('Nome')).toHaveValue('Carlos Financeiro'))
  })
})
