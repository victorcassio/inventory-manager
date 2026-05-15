import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from '@/components/layout/ProtectedRoute'
import { useAuthStore } from '@/stores/auth.store'

// Mock the auth store
vi.mock('@/stores/auth.store', () => ({
  useAuthStore: vi.fn(),
}))

const mockUseAuthStore = useAuthStore as unknown as ReturnType<typeof vi.fn>

function TestChild() {
  return <div>Protected Content</div>
}

function LoginPage() {
  return <div>Login Page</div>
}

function renderWithRouter(isAuthenticated: boolean) {
  mockUseAuthStore.mockReturnValue({ isAuthenticated })
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/dashboard" element={<TestChild />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('ProtectedRoute', () => {
  it('redirects to /login when not authenticated', () => {
    renderWithRouter(false)
    expect(screen.getByText('Login Page')).toBeInTheDocument()
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument()
  })

  it('renders children when authenticated', () => {
    renderWithRouter(true)
    expect(screen.getByText('Protected Content')).toBeInTheDocument()
    expect(screen.queryByText('Login Page')).not.toBeInTheDocument()
  })
})
