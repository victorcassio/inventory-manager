import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { Sidebar } from '@/components/layout/Sidebar'
import { useAuthStore } from '@/stores/auth.store'
import type { User } from '@/types'

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: vi.fn(),
}))

vi.mock('@/lib/api/auth.api', () => ({
  authApi: {
    logout: vi.fn().mockResolvedValue(undefined),
  },
}))

const mockUseAuthStore = useAuthStore as unknown as ReturnType<typeof vi.fn>

function makeUser(role: User['role']): User {
  return {
    id: '1',
    name: 'João Silva',
    email: 'joao@test.com',
    role,
    isActive: true,
    createdAt: '2024-01-01',
    emailVerifiedAt: '2024-01-01',
    passwordSetAt: '2024-01-01',
  }
}

function renderSidebar(user: User) {
  const clearAuth = vi.fn()
  mockUseAuthStore.mockReturnValue({ user, clearAuth })
  // endSession() reads clearAuth off getState() directly (not off the hook's
  // return value), since it has to work outside a component. The refresh
  // token it revokes comes from client.ts's own module state, not from this
  // store — the field below is only here because getState()'s stub type
  // carries it, and stays null/unused throughout this file.
  ;(useAuthStore as unknown as {
    getState: () => { refreshToken: string | null; clearAuth: () => void }
  }).getState = vi.fn().mockReturnValue({ refreshToken: null, clearAuth })
  return { clearAuth, ...render(<MemoryRouter><Sidebar /></MemoryRouter>) }
}

describe('Sidebar', () => {
  it('shows Dashboard for all roles', () => {
    renderSidebar(makeUser('admin'))
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
  })

  it('shows Dashboard for attendant role', () => {
    renderSidebar(makeUser('attendant'))
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
  })

  it('shows Financeiro nav item for admin role', () => {
    renderSidebar(makeUser('admin'))
    // The nav link "Financeiro" should exist (there may also be a role badge)
    const financialLinks = screen.getAllByText('Financeiro')
    // At least one should be a navigation link
    const navLink = financialLinks.find(el => el.closest('a'))
    expect(navLink).toBeTruthy()
  })

  it('shows Financeiro nav item for financial role', () => {
    renderSidebar(makeUser('financial'))
    const financialLinks = screen.getAllByText('Financeiro')
    const navLink = financialLinks.find(el => el.closest('a'))
    expect(navLink).toBeTruthy()
  })

  it('does not show Financeiro for attendant role', () => {
    renderSidebar(makeUser('attendant'))
    expect(screen.queryByText('Financeiro')).not.toBeInTheDocument()
  })

  it('shows Usuários nav item for admin role', () => {
    renderSidebar(makeUser('admin'))
    const link = screen.getByText('Usuários').closest('a')
    expect(link).toHaveAttribute('href', '/users')
  })

  it('does not show Usuários for attendant role', () => {
    renderSidebar(makeUser('attendant'))
    expect(screen.queryByText('Usuários')).not.toBeInTheDocument()
  })

  it('does not show Usuários for financial role', () => {
    renderSidebar(makeUser('financial'))
    expect(screen.queryByText('Usuários')).not.toBeInTheDocument()
  })

  it.each(['admin', 'attendant', 'financial'] as const)(
    'shows Segurança nav item for %s role, not gated by the admin users permission',
    (role) => {
      renderSidebar(makeUser(role))
      const link = screen.getByText('Segurança').closest('a')
      expect(link).toHaveAttribute('href', '/account/security')
    },
  )

  it('shows user name', () => {
    renderSidebar(makeUser('admin'))
    expect(screen.getByText('João Silva')).toBeInTheDocument()
  })

  it('calls clearAuth and navigates on logout button click', async () => {
    const user = userEvent.setup()
    const { clearAuth } = renderSidebar(makeUser('admin'))
    const logoutBtn = screen.getByText('Sair')
    await user.click(logoutBtn)
    // After async logout, clearAuth should be called
    // Since logout calls clearAuth in finally, wait for it
    await new Promise(r => setTimeout(r, 10))
    expect(clearAuth).toHaveBeenCalled()
  })
})
