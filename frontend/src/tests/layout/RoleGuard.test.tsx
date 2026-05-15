import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { RoleGuard } from '@/components/layout/RoleGuard'
import { useAuthStore } from '@/stores/auth.store'
import type { User } from '@/types'

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: vi.fn(),
}))

const mockUseAuthStore = useAuthStore as unknown as ReturnType<typeof vi.fn>

function ProtectedContent() {
  return <div>Protected Content</div>
}

function ForbiddenPage() {
  return <div>403 Forbidden</div>
}

function makeUser(role: string): User {
  return {
    id: '1',
    name: 'Test',
    email: 'test@test.com',
    role: role as User['role'],
    isActive: true,
    createdAt: '2024-01-01',
  }
}

function renderGuard(user: User | null, allowedRoles: User['role'][]) {
  mockUseAuthStore.mockReturnValue({ user })
  return render(
    <MemoryRouter initialEntries={['/protected']}>
      <Routes>
        <Route path="/403" element={<ForbiddenPage />} />
        <Route element={<RoleGuard allowedRoles={allowedRoles} />}>
          <Route path="/protected" element={<ProtectedContent />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('RoleGuard', () => {
  it('redirects to /403 when role not in allowedRoles', () => {
    renderGuard(makeUser('financial'), ['admin'])
    expect(screen.getByText('403 Forbidden')).toBeInTheDocument()
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument()
  })

  it('renders children when role matches', () => {
    renderGuard(makeUser('admin'), ['admin', 'attendant'])
    expect(screen.getByText('Protected Content')).toBeInTheDocument()
    expect(screen.queryByText('403 Forbidden')).not.toBeInTheDocument()
  })

  it('redirects to /403 when user is null', () => {
    renderGuard(null, ['admin'])
    expect(screen.getByText('403 Forbidden')).toBeInTheDocument()
  })
})
