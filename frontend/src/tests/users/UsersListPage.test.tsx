import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { UsersListPage } from '@/features/users/pages/UsersListPage'
import { useUsersList } from '@/features/users/hooks/useUsers'
import { useAuthStore } from '@/stores/auth.store'
import type { AdminUser } from '@/types'

vi.mock('@/features/users/hooks/useUsers', async () => {
  const actual = await vi.importActual<typeof import('@/features/users/hooks/useUsers')>(
    '@/features/users/hooks/useUsers',
  )
  return {
    ...actual,
    useUsersList: vi.fn(),
    useUpdateUserStatus: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
    useResendInvitation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
    useRevokeInvitation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  }
})
vi.mock('@/stores/auth.store', () => ({
  useAuthStore: vi.fn(),
}))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => vi.fn() }
})

const mockUseUsersList = useUsersList as unknown as ReturnType<typeof vi.fn>
const mockUseAuthStore = useAuthStore as unknown as ReturnType<typeof vi.fn>

function makeAdminUser(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: 'u-1',
    name: 'Ana Atendente',
    email: 'ana@example.com',
    role: 'attendant',
    isActive: true,
    emailVerifiedAt: '2026-01-01T00:00:00Z',
    passwordSetAt: '2026-01-01T00:00:00Z',
    lastLogin: '2026-06-01T10:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    invitationStatus: 'accepted',
    invitationExpiresAt: null,
    ...overrides,
  }
}

function setupMocks(role = 'admin') {
  mockUseAuthStore.mockReturnValue({ user: { id: 'me-1', role } })
  mockUseUsersList.mockReturnValue({
    data: { data: [makeAdminUser()], total: 1, page: 1, limit: 20 },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  })
}

function renderPage() {
  return render(
    <MemoryRouter>
      <UsersListPage />
    </MemoryRouter>,
  )
}

describe('UsersListPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the desktop table with all required columns', () => {
    setupMocks()
    renderPage()

    expect(screen.getByRole('columnheader', { name: 'Nome' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'E-mail' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Perfil' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Convite' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'E-mail verificado' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Último login' })).toBeInTheDocument()
    expect(screen.getAllByText('Ana Atendente').length).toBeGreaterThan(0)
    expect(screen.getAllByText('ana@example.com').length).toBeGreaterThan(0)
  })

  it('renders a compact mobile list with the same user data', () => {
    setupMocks()
    const { container } = renderPage()

    const mobileList = container.querySelector('.lg\\:hidden.space-y-3')
    expect(mobileList).toBeTruthy()
    expect(mobileList?.textContent).toContain('Ana Atendente')
    expect(mobileList?.textContent).toContain('ana@example.com')
  })

  it('shows a loading state', () => {
    mockUseAuthStore.mockReturnValue({ user: { id: 'me-1', role: 'admin' } })
    mockUseUsersList.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() })
    renderPage()

    expect(screen.getByRole('status')).toHaveTextContent('Carregando usuários')
  })

  it('shows an empty state with a call to action when there are no filters', () => {
    mockUseAuthStore.mockReturnValue({ user: { id: 'me-1', role: 'admin' } })
    mockUseUsersList.mockReturnValue({
      data: { data: [], total: 0, page: 1, limit: 20 },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })
    renderPage()

    expect(screen.getByRole('heading', { name: 'Nenhum usuário encontrado' })).toBeInTheDocument()
    expect(screen.getByText('Cadastre o primeiro usuário para começar.')).toBeInTheDocument()
    // The live region announces the same outcome for a screen-reader user.
    expect(screen.getByRole('status')).toHaveTextContent('Nenhum usuário encontrado')
  })

  it('shows an error state with retry', async () => {
    const refetch = vi.fn()
    mockUseAuthStore.mockReturnValue({ user: { id: 'me-1', role: 'admin' } })
    mockUseUsersList.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch })
    const user = userEvent.setup()
    renderPage()

    const retryButton = screen.getByRole('button', { name: /tentar novamente/i })
    await user.click(retryButton)
    expect(refetch).toHaveBeenCalled()
  })

  it('debounces search input before querying', async () => {
    setupMocks()
    const user = userEvent.setup()
    renderPage()

    const searchInput = screen.getByLabelText('Buscar por nome ou e-mail')
    await user.type(searchInput, 'maria')

    // Not immediately: the query only updates after the debounce window.
    expect(mockUseUsersList).not.toHaveBeenLastCalledWith(
      expect.objectContaining({ search: 'maria' }),
    )

    await waitFor(
      () =>
        expect(mockUseUsersList).toHaveBeenLastCalledWith(
          expect.objectContaining({ search: 'maria' }),
        ),
      { timeout: 1000 },
    )
  })

  it('filters by role and resets to page 1', async () => {
    setupMocks()
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByLabelText('Filtrar por perfil'))
    await user.click(await screen.findByRole('option', { name: 'Financeiro' }))

    await waitFor(() =>
      expect(mockUseUsersList).toHaveBeenLastCalledWith(
        expect.objectContaining({ role: 'financial', page: 1 }),
      ),
    )
  })

  it('filters by status', async () => {
    setupMocks()
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByLabelText('Filtrar por status'))
    await user.click(await screen.findByRole('option', { name: 'Inativos' }))

    await waitFor(() =>
      expect(mockUseUsersList).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'inactive' }),
      ),
    )
  })

  it('shows the FilterPanel active count and clears filters', async () => {
    setupMocks()
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByLabelText('Filtrar por perfil'))
    await user.click(await screen.findByRole('option', { name: 'Financeiro' }))

    await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument())

    const clearButtons = screen.getAllByRole('button', { name: /limpar filtros/i })
    await user.click(clearButtons[0])

    await waitFor(() =>
      expect(mockUseUsersList).toHaveBeenLastCalledWith(
        expect.objectContaining({ role: undefined, status: undefined, search: undefined }),
      ),
    )
  })

  it('cancels a pending debounced search when filters are cleared', async () => {
    setupMocks()
    const user = userEvent.setup()
    renderPage()

    // Set a real filter too, so "Limpar filtros" is actually rendered.
    await user.click(screen.getByLabelText('Filtrar por perfil'))
    await user.click(await screen.findByRole('option', { name: 'Financeiro' }))
    await waitFor(() =>
      expect(mockUseUsersList).toHaveBeenLastCalledWith(expect.objectContaining({ role: 'financial' })),
    )

    // Type a search, then clear everything BEFORE the 300ms debounce fires.
    await user.type(screen.getByLabelText('Buscar por nome ou e-mail'), 'maria')
    const clearButtons = screen.getAllByRole('button', { name: /limpar filtros/i })
    await user.click(clearButtons[0])

    // Without cancelling the pending timer, it fires here and reinstates the
    // search this click just cleared.
    await new Promise((resolve) => setTimeout(resolve, 350))

    expect(mockUseUsersList).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: undefined, role: undefined }),
    )
  })

  it('shows pagination when total exceeds the page limit', () => {
    mockUseAuthStore.mockReturnValue({ user: { id: 'me-1', role: 'admin' } })
    mockUseUsersList.mockReturnValue({
      data: { data: [makeAdminUser()], total: 45, page: 1, limit: 20 },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })
    renderPage()

    expect(screen.getByText(/Mostrando 1–20 de 45/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Próxima' })).not.toBeDisabled()
  })

  it('only shows invitationExpiresAt for a pending invitation', () => {
    mockUseAuthStore.mockReturnValue({ user: { id: 'me-1', role: 'admin' } })
    mockUseUsersList.mockReturnValue({
      data: {
        data: [
          makeAdminUser({
            id: 'u-pending',
            invitationStatus: 'pending',
            invitationExpiresAt: '2026-06-15T00:00:00Z',
          }),
          makeAdminUser({
            id: 'u-accepted',
            name: 'Bruno Aceito',
            invitationStatus: 'accepted',
            invitationExpiresAt: null,
          }),
        ],
        total: 2,
        page: 1,
        limit: 20,
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    })
    const { container } = renderPage()

    // Both the desktop table and the mobile list are always in the DOM in
    // jsdom (their visibility is CSS-only), so each real occurrence renders
    // twice. What matters is that it is the SAME user in both, and that the
    // accepted invitation never shows an expiry.
    const desktopRows = container.querySelectorAll('.hidden.lg\\:block tbody tr')
    expect(desktopRows).toHaveLength(2)
    expect(desktopRows[0].textContent).toMatch(/expira em/i)
    expect(desktopRows[1].textContent).not.toMatch(/expira em/i)
  })

  it('never renders password, hash, digest or token fields on the row', () => {
    setupMocks()
    const { container } = renderPage()

    const html = container.innerHTML.toLowerCase()
    for (const term of ['password', 'senha', 'hash', 'digest', 'tokenhash', 'refreshtoken']) {
      expect(html).not.toContain(term)
    }
  })
})
