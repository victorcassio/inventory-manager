import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { LoginForm } from '@/features/auth/components/LoginForm'
import { useAuth } from '@/features/auth/hooks/useAuth'

vi.mock('@/features/auth/hooks/useAuth', () => ({
  useAuth: vi.fn(),
}))

const mockUseAuth = useAuth as ReturnType<typeof vi.fn>

function renderLoginForm(loginFn: () => Promise<void> = vi.fn(), initialEntries?: unknown[]) {
  mockUseAuth.mockReturnValue({ login: loginFn, user: null, isAuthenticated: false, logout: vi.fn() })
  return render(
    <MemoryRouter initialEntries={(initialEntries as never) ?? ['/login']}>
      <LoginForm />
    </MemoryRouter>,
  )
}

describe('LoginForm', () => {
  it('renders email and password fields', () => {
    renderLoginForm()
    expect(screen.getByLabelText('E-mail')).toBeInTheDocument()
    expect(screen.getByLabelText('Senha')).toBeInTheDocument()
  })

  it('shows validation errors when submitted with empty fields', async () => {
    const user = userEvent.setup()
    renderLoginForm()
    await user.click(screen.getByRole('button', { name: /entrar/i }))
    await waitFor(() => {
      expect(screen.getByText('E-mail inválido')).toBeInTheDocument()
      expect(screen.getByText('Senha obrigatória')).toBeInTheDocument()
    })
  })

  it('calls login with valid data', async () => {
    const user = userEvent.setup()
    const loginFn = vi.fn().mockResolvedValue(undefined)
    renderLoginForm(loginFn)

    await user.type(screen.getByLabelText('E-mail'), 'admin@test.com')
    await user.type(screen.getByLabelText('Senha'), 'password123')
    await user.click(screen.getByRole('button', { name: /entrar/i }))

    await waitFor(() => {
      expect(loginFn).toHaveBeenCalledWith('admin@test.com', 'password123')
    })
  })

  it('shows API error on failed login with 401', async () => {
    const user = userEvent.setup()
    const error = { response: { status: 401 } }
    const loginFn = vi.fn().mockRejectedValue(error)
    renderLoginForm(loginFn)

    await user.type(screen.getByLabelText('E-mail'), 'wrong@test.com')
    await user.type(screen.getByLabelText('Senha'), 'wrongpassword')
    await user.click(screen.getByRole('button', { name: /entrar/i }))

    await waitFor(() => {
      expect(screen.getByText('Credenciais inválidas')).toBeInTheDocument()
    })
  })

  it('offers a show/hide toggle on the password field, like the other password fields in this branch', () => {
    renderLoginForm()
    expect(screen.getByRole('button', { name: 'Mostrar senha' })).toBeInTheDocument()
  })

  it('renders the security notice from navigation state into an already-mounted role="status" region', async () => {
    renderLoginForm(vi.fn(), [
      { pathname: '/login', state: { securityNotice: 'password-changed' } },
    ])
    // Mounts empty (see LoginForm: text arrives one tick later via an
    // effect, so an already-complete live region is never inserted as a
    // fait accompli) and is filled shortly after — both states are
    // reachable from this one render.
    await waitFor(() => {
      expect(screen.getByText('Senha alterada. Faça login novamente.')).toBeInTheDocument()
    })
  })
})
